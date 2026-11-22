param([ValidateSet('auto', 'en', 'de')][string]$Language = 'auto', [switch]$StatusOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Reply($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }
$engine = $null
try {
    Add-Type -AssemblyName System.Speech
    $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
    $languages = @($recognizers | ForEach-Object { $_.Culture.Name } | Sort-Object -Unique)
    # Inventory never opens audio, loads a grammar, or changes Windows settings.
    if ($StatusOnly) { Reply @{ type = 'ready'; languages = $languages }; exit 0 }
    $prefix = if ($Language -eq 'de') { 'de' } else { 'en' }
    $preferred = if ($prefix -eq 'de') { 'de-DE' } else { 'en-US' }
    $selected = $recognizers | Where-Object { $_.Culture.Name -eq $preferred } | Select-Object -First 1
    if ($null -eq $selected) { $selected = $recognizers | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq $prefix } | Select-Object -First 1 }
    if ($null -eq $selected) { throw "No installed $prefix offline speech recognizer. Install the language's speech support in Windows settings." }
    # C# event handlers run on recognition threads; PowerShell script blocks cannot.
    Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Speech.Recognition;
using System.Threading;
public static class PrmtaSpeech {
    public static string Transcribe(SpeechRecognitionEngine engine, byte[] bytes) {
        if (bytes.Length < 44 || bytes.Length > 810000) throw new ArgumentException("Invalid WAV size.");
        using (var stream = new MemoryStream(bytes, false))
        using (var done = new ManualResetEvent(false)) {
            var words = new List<string>(); Exception failure = null;
            EventHandler<SpeechRecognizedEventArgs> recognized = (sender, args) => { if (args.Result != null && !String.IsNullOrWhiteSpace(args.Result.Text)) words.Add(args.Result.Text); };
            EventHandler<RecognizeCompletedEventArgs> completed = (sender, args) => { failure = args.Error; done.Set(); };
            engine.SpeechRecognized += recognized; engine.RecognizeCompleted += completed;
            try {
                engine.SetInputToWaveStream(stream);
                engine.RecognizeAsync(RecognizeMode.Multiple);
                if (!done.WaitOne(35000)) {
                    engine.RecognizeAsyncCancel();
                    done.WaitOne(2000);
                    throw new TimeoutException("Native recognition timed out.");
                }
                if (failure != null) throw new InvalidOperationException("Native recognition failed.", failure);
                return String.Join(" ", words);
            } finally {
                engine.SpeechRecognized -= recognized; engine.RecognizeCompleted -= completed;
                engine.SetInputToNull();
            }
        }
    }
}
'@
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($selected)
    $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(3)
    $engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(350)
    $engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(600)
    Reply @{ type = 'ready'; languages = $languages; language = $selected.Culture.Name }
    while ($null -ne ($line = [Console]::In.ReadLine())) {
        $id = $null
        try {
            if ($line.Length -gt 1100000) { throw 'Audio request is too large.' }
            $request = $line | ConvertFrom-Json
            $id = $request.id
            if ($null -eq $id -or $id -isnot [ValueType] -or [double]$id -le 0 -or [double]$id -ne [Math]::Floor([double]$id)) { throw 'Invalid request ID.' }
            $bytes = [Convert]::FromBase64String([string]$request.wav)
            $watch = [Diagnostics.Stopwatch]::StartNew()
            $text = [PrmtaSpeech]::Transcribe($engine, $bytes)
            $watch.Stop()
            Reply @{ id = $id; text = $text; ms = $watch.ElapsedMilliseconds }
        } catch { Reply @{ id = $id; error = $_.Exception.Message } }
        finally { $bytes = $null; $request = $null; $line = $null; $text = $null }
    }
} catch { Reply @{ type = 'fatal'; error = $_.Exception.Message }; exit 1 }
finally { if ($null -ne $engine) { $engine.Dispose() } }
