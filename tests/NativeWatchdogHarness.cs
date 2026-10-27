using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.Serialization;
using System.Windows.Controls;

namespace KurumiStartup {
    // Executes the production Tick method with no Window constructor, media source,
    // bootstrap, or native-window calls. The stopwatch is advanced without waiting.
    internal static class NativeWatchdogHarness {
        private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

        [STAThread]
        private static int Main() {
            int failures = 0;
            failures += Check("cold initialization does not spend decoder budget", 9000, 9000, false, 0, false);
            failures += Check("decoder gets the last millisecond of its eight-second budget", 16999, 9000, false, 0, false);
            failures += Check("a decoder that never opens still fails open", 17001, 9000, false, 0, true);
            failures += Check("opened playback is independent of open budget", 23000, 9000, true, 16000, false);
            failures += Check("stalled opened playback remains bounded", 30001, 9000, true, 16000, true);
            Environment.ExitCode = failures == 0 ? 0 : 1;
            return Environment.ExitCode;
        }

        private static int Check(string name, long elapsedMs, long requestedAt, bool opened, long openedAt, bool expectedTimeout) {
            string journal = Path.Combine(NativeStartup.Root, "native-startup.log");
            if(File.Exists(journal)) File.Delete(journal);
            NativeStartup.Clock.Stop();
            FieldInfo elapsed = typeof(Stopwatch).GetField("elapsed", PrivateInstance)
                ?? typeof(Stopwatch).GetField("_elapsed", PrivateInstance);
            if(elapsed == null) throw new InvalidOperationException("Cannot control this runtime's Stopwatch for the regression test.");
            elapsed.SetValue(NativeStartup.Clock, elapsedMs * Stopwatch.Frequency / 1000);
            var splash = (Splash)FormatterServices.GetUninitializedObject(typeof(Splash));
            var media = new MediaElement { LoadedBehavior = MediaState.Manual, UnloadedBehavior = MediaState.Close };
            Set(splash,"media",media);
            Set(splash,"opened",opened);
            Set(splash,"openedAt",openedAt);
            Set(splash,"finished",true); // A timeout is observed through its real log; Finish has no external effects.
            FieldInfo request = typeof(Splash).GetField("mediaRequestedAt",PrivateInstance);
            if(request != null) request.SetValue(splash,requestedAt);
            typeof(Splash).GetMethod("Tick",PrivateInstance).Invoke(splash,null);
            bool timedOut = File.Exists(journal) && File.ReadAllText(journal).Contains("\"event\":\"PlaybackTimeout\"");
            media.Close();
            bool passed = timedOut == expectedTimeout;
            Console.WriteLine((passed ? "PASS " : "FAIL ") + name + " (timeout=" + timedOut + ", expected=" + expectedTimeout + ")");
            return passed ? 0 : 1;
        }

        private static void Set(Splash splash,string name,object value) {
            typeof(Splash).GetField(name,PrivateInstance).SetValue(splash,value);
        }
    }
}
