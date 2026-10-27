using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace KurumiStartup {
    public sealed class Settings {
        public string[] playlist { get; set; }
        public string codexExecutable { get; set; }
        public int durationSeconds { get; set; }
        public string startupMode { get; set; }
        public string nodeExecutable { get; set; }
    }

    public static class NativeStartup {
        internal static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
        internal static readonly Stopwatch Clock = Stopwatch.StartNew();
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly object JournalLock = new object();
        private static int bootstrapSpawned;

        [STAThread]
        public static int Main(string[] args) {
            Native.SetProcessDPIAware();
            string key;
            using (var sha = SHA256.Create()) key = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Root.ToLowerInvariant()))).Replace("-", "").Substring(0,24);
            using (var lease = new Mutex(false, "Local\\CodexKurumiIntro-" + key)) {
                bool owned;
                try { owned = lease.WaitOne(0); } catch (AbandonedMutexException) { owned = true; }
                if (!owned) { Log("DuplicateIgnored"); return 0; }
                try {
                    var settings = Json.Deserialize<Settings>(File.ReadAllText(Path.Combine(Root,"config.json"), Encoding.UTF8));
                    bool preview = args.Contains("--preview");
                    if(!preview && !args.Contains("--native") && settings.startupMode == "in-app-overlay") {
                        return RunInApp(settings,args);
                    }
                    string requested = args.FirstOrDefault(x => x.StartsWith("--film=", StringComparison.Ordinal));
                    var films = settings.playlist ?? new string[0];
                    if (films.Length == 0) throw new InvalidDataException("The intro playlist is empty.");
                    string previous = null;
                    try { previous = Json.Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(Root,"selection.json"), Encoding.UTF8))["last"]; } catch { }
                    string[] choices = films.Where(x => x != previous || films.Length == 1).ToArray();
                    string film = requested == null ? choices[new Random().Next(choices.Length)] : requested.Substring(7);
                    if (!films.Contains(film) || Path.GetFileName(film) != film) throw new InvalidDataException("The requested film is not in the playlist.");
                    string path = Path.Combine(Root,"films",film);
                    if (!File.Exists(path)) throw new FileNotFoundException("Intro video was not found.", path);
                    if (!preview) File.WriteAllText(Path.Combine(Root,"selection.json"), Json.Serialize(new { last = film }), new UTF8Encoding(false));
                    Log("Launch", "film",film, "preview",preview);
                    var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
                    app.Run(new Splash(path, preview));
                    return Environment.ExitCode;
                } catch(Exception error) {
                    Log("LauncherError","message",error.ToString());
                    // A failed video must never prevent the actual app from opening.
                    if (!args.Contains("--preview")) StartBootstrap();
                    return 1;
                } finally { lease.ReleaseMutex(); }
            }
        }

        private static int RunInApp(Settings settings,string[] args) {
            settings.nodeExecutable = ResolveNodeExecutable(settings.nodeExecutable);
            string script = Path.Combine(Root,"intro.mjs");
            if(!File.Exists(script)) throw new FileNotFoundException("The in-app startup launcher was not found.",script);
            string arguments = QuoteArgument(script) + " --bootstrap-started";
            foreach(string arg in args.Where(x => x.StartsWith("--film=",StringComparison.Ordinal))) arguments += " " + QuoteArgument(arg);
            using(var child = new Process { StartInfo = new ProcessStartInfo {
                FileName = settings.nodeExecutable, Arguments = arguments, WorkingDirectory = Root,
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
            } }) {
                child.Start();
                Log("InAppLauncherStarted","helperPid",child.Id);
                StartBootstrap();
                // Keep the installation mutex until the bounded Node startup ends.
                // A failed in-app film never starts a second native animation.
                if(!child.WaitForExit(90000)) { Log("InAppLauncherTimeout"); return 1; }
                Log("InAppLauncherFinished","exitCode",child.ExitCode);
                return child.ExitCode;
            }
        }

        private static string ResolveNodeExecutable(string configured) {
            if(!String.IsNullOrWhiteSpace(configured)) {
                if(!Path.IsPathRooted(configured) || !File.Exists(configured))
                    throw new FileNotFoundException("The configured installed Node runtime was not found.",configured);
                return Path.GetFullPath(configured);
            }
            var candidates = new List<string> {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".cache","codex-runtimes","codex-primary-runtime","dependencies","node","bin","node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"nodejs","node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"nodejs","node.exe")
            };
            foreach(string entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)) {
                string directory = entry.Trim().Trim('"');
                if(Path.IsPathRooted(directory)) candidates.Add(Path.Combine(directory,"node.exe"));
            }
            foreach(string candidate in candidates)
                if(Path.IsPathRooted(candidate) && File.Exists(candidate)) return Path.GetFullPath(candidate);
            throw new FileNotFoundException("Node.js 22.3+ was not found. Install Node.js or set nodeExecutable in config.json to its absolute path.");
        }

        private static string QuoteArgument(string value) {
            var result = new StringBuilder("\""); int slashes = 0;
            foreach(char c in value) {
                if(c == '\\') { slashes++; continue; }
                if(c == '"') { result.Append('\\',slashes*2+1); result.Append(c); }
                else { result.Append('\\',slashes); result.Append(c); }
                slashes = 0;
            }
            result.Append('\\',slashes*2); result.Append('"'); return result.ToString();
        }

        internal static void Log(string name, params object[] fields) {
            var entry = new Dictionary<string,object> {
                {"event",name}, {"utc",DateTime.UtcNow.ToString("o")},
                {"elapsedMs",Clock.ElapsedMilliseconds}, {"pid",Process.GetCurrentProcess().Id}
            };
            for (int i=0;i+1<fields.Length;i+=2) entry[(string)fields[i]] = fields[i+1];
            lock(JournalLock) {
                try { File.AppendAllText(Path.Combine(Root,"native-startup.log"),Json.Serialize(entry)+Environment.NewLine,new UTF8Encoding(false)); } catch { }
            }
        }

        internal static void StartBootstrap() {
            if(Interlocked.Exchange(ref bootstrapSpawned,1) != 0) return;
            try {
                var start = new ProcessStartInfo {
                    FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell\\v1.0\\powershell.exe"),
                    Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(Root,"Start-CodexForIntro.ps1") + "\" -NativeSplash",
                    WorkingDirectory = Root, UseShellExecute = false, CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                var process = new Process { StartInfo = start, EnableRaisingEvents = true };
                process.Exited += (s,e) => { try { Log("BootstrapFinished","exitCode",process.ExitCode); process.Dispose(); } catch { } };
                process.Start();
                Log("BootstrapStarted","helperPid",process.Id);
            } catch(Exception error) { Log("BootstrapError","message",error.Message); }
        }
    }

    internal sealed class Splash : Window {
        private readonly MediaElement media;
        private readonly string path;
        private readonly bool preview;
        private readonly DispatcherTimer watchdog;
        private Forms.Screen screen;
        private IntPtr handle;
        private bool rendered, opened, finished;
        private int checkpoint;
        private long openedAt, mediaRequestedAt;

        internal Splash(string filmPath, bool previewOnly) {
            path = filmPath; preview = previewOnly;
            Title = "Codex Kurumi Startup";
            WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = true; Topmost = true; Background = Brushes.Black;
            WindowStartupLocation = WindowStartupLocation.Manual;
            screen = Forms.Screen.FromPoint(Forms.Cursor.Position);
            Left = screen.Bounds.Left; Top = screen.Bounds.Top;
            Width = screen.Bounds.Width; Height = screen.Bounds.Height;
            var layout = new Grid { Background = Brushes.Black };
            media = new MediaElement {
                LoadedBehavior = MediaState.Manual, UnloadedBehavior = MediaState.Close,
                Stretch = Stretch.Uniform, Volume = 0.75, ScrubbingEnabled = true
            };
            layout.Children.Add(media);
            var skip = new Button {
                Content = "跳过 · Esc", HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(24),
                Padding = new Thickness(12,6,12,6), Foreground = Brushes.White,
                Background = new SolidColorBrush(Color.FromArgb(100,0,0,0)),
                BorderBrush = new SolidColorBrush(Color.FromArgb(80,255,255,255)),
                FontSize = 13, Cursor = Cursors.Hand, Focusable = false
            };
            skip.Click += (s,e) => Finish("Skipped");
            layout.Children.Add(skip); Content = layout;
            SourceInitialized += (s,e) => {
                handle = new WindowInteropHelper(this).Handle;
                Native.SetWindowPos(handle,new IntPtr(-1),screen.Bounds.Left,screen.Bounds.Top,screen.Bounds.Width,screen.Bounds.Height,0x0040);
            };
            ContentRendered += (s,e) => Start();
            PreviewKeyDown += (s,e) => { if(e.Key == Key.Escape) { e.Handled = true; Finish("Skipped"); } };
            media.MediaOpened += (s,e) => {
                opened = true; openedAt = NativeStartup.Clock.ElapsedMilliseconds;
                NativeStartup.Log("MediaOpened","width",media.NaturalVideoWidth,"height",media.NaturalVideoHeight,
                    "durationSeconds",media.NaturalDuration.HasTimeSpan ? media.NaturalDuration.TimeSpan.TotalSeconds : 0,
                    "openWaitMs",openedAt-mediaRequestedAt);
            };
            media.MediaEnded += (s,e) => {
                NativeStartup.Log("MediaEnded","positionSeconds",media.Position.TotalSeconds);
                Finish("Ended");
            };
            media.MediaFailed += (s,e) => {
                NativeStartup.Log("MediaFailed","message",e.ErrorException == null ? "Unknown decoder error" : e.ErrorException.ToString());
                Environment.ExitCode = 1; Finish("MediaFailed");
            };
            watchdog = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
            watchdog.Tick += (s,e) => Tick();
            Closing += (s,e) => { if(!finished) { finished = true; watchdog.Stop(); media.Close(); NativeStartup.Log("CoverClosed","reason","WindowClosed"); } };
        }

        private void Start() {
            if(rendered) return;
            rendered = true;
            try { Native.DwmFlush(); } catch { }
            Native.Rect actual; Native.GetWindowRect(handle,out actual);
            bool covers = actual.Left <= screen.Bounds.Left && actual.Top <= screen.Bounds.Top && actual.Right >= screen.Bounds.Right && actual.Bottom >= screen.Bounds.Bottom;
            NativeStartup.Log("CoverShown","topmost",Topmost,"coversMonitor",covers,
                "left",actual.Left,"top",actual.Top,"width",actual.Right-actual.Left,"height",actual.Bottom-actual.Top);
            // No app, debugger, network, or chat-DOM prerequisite before this point.
            if(!preview) NativeStartup.StartBootstrap();
            mediaRequestedAt = NativeStartup.Clock.ElapsedMilliseconds;
            NativeStartup.Log("MediaRequested","openTimeoutMs",8000);
            media.Source = new Uri(path,UriKind.Absolute);
            media.Play(); watchdog.Start();
        }

        private void Tick() {
            double position = media.Position.TotalSeconds;
            if(opened && checkpoint < 3 && position >= new double[]{0.25,4,7}[checkpoint]) {
                checkpoint++;
                NativeStartup.Log("MediaProgress","positionSeconds",position,"foreground",Native.GetForegroundWindow() == handle);
            }
            // Separate from playback duration: never leave a failed decoder covering the desktop.
            if((!opened && NativeStartup.Clock.ElapsedMilliseconds-mediaRequestedAt > 8000) ||
               (opened && NativeStartup.Clock.ElapsedMilliseconds-openedAt > 14000)) {
                NativeStartup.Log("PlaybackTimeout","positionSeconds",position,
                    "phase",opened ? "playback" : "open","openWaitMs",(opened ? openedAt : NativeStartup.Clock.ElapsedMilliseconds)-mediaRequestedAt);
                Environment.ExitCode = 1; Finish("Timeout");
            }
        }

        private void Finish(string reason) {
            if(finished) return;
            finished = true; watchdog.Stop();
            if(!preview) {
                // Bring the verified official main window beneath our opaque topmost cover.
                IntPtr codex = Native.FindCodexWindow();
                if(codex != IntPtr.Zero) {
                    if(Native.IsIconic(codex)) Native.ShowWindow(codex,9);
                    Native.SetForegroundWindow(codex);
                    NativeStartup.Log("CodexRevealed","handle",codex.ToInt64());
                } else NativeStartup.Log("CodexWindowPending");
            }
            media.Close();
            NativeStartup.Log("CoverClosed","reason",reason);
            Close();
        }
    }

    internal static class Native {
        [StructLayout(LayoutKind.Sequential)] internal struct Rect { internal int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] private struct Point { internal int X,Y; }
        [StructLayout(LayoutKind.Sequential)] private struct Placement {
            internal int Length,Flags,ShowCommand;
            internal Point MinPosition,MaxPosition;
            internal Rect Normal;
        }
        internal delegate bool EnumWindowProc(IntPtr hwnd,IntPtr data);
        [DllImport("user32.dll")] internal static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int hgt,uint flags);
        [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr h,out Rect rect);
        [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr h,int command);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback,IntPtr data);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
        [DllImport("user32.dll")] private static extern bool GetWindowPlacement(IntPtr h,ref Placement placement);
        [DllImport("dwmapi.dll")] internal static extern int DwmFlush();
        [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder path,ref int size);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

        internal static IntPtr FindCodexWindow() {
            var pids = new HashSet<uint>();
            string apps = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"WindowsApps");
            string official = "^" + Regex.Escape(apps) + @"\\OpenAI\.Codex_\d+\.\d+\.\d+\.\d+_(?:x64|arm64|x86)__2p2nqsd0c76g0\\app\\ChatGPT\.exe$";
            foreach(var process in Process.GetProcessesByName("ChatGPT")) {
                using(process) {
                    IntPtr opened = OpenProcess(0x1000,false,(uint)process.Id);
                    if(opened == IntPtr.Zero) continue;
                    try {
                        var path = new StringBuilder(32768); int length = path.Capacity;
                        if(QueryFullProcessImageName(opened,0,path,ref length) && Regex.IsMatch(path.ToString(),official,RegexOptions.IgnoreCase)) pids.Add((uint)process.Id);
                    } finally { CloseHandle(opened); }
                }
            }
            IntPtr chosen = IntPtr.Zero; long largest = 0;
            EnumWindows((h,data) => {
                uint pid; GetWindowThreadProcessId(h,out pid);
                if(pids.Contains(pid) && IsWindowVisible(h)) {
                    Rect rect; if(GetWindowRect(h,out rect)) {
                        if(IsIconic(h)) {
                            var placement = new Placement { Length = Marshal.SizeOf(typeof(Placement)) };
                            if(GetWindowPlacement(h,ref placement)) rect = placement.Normal;
                        }
                        long area = (long)(rect.Right-rect.Left)*(rect.Bottom-rect.Top);
                        if(area>largest && rect.Right-rect.Left>400 && rect.Bottom-rect.Top>300) { chosen=h; largest=area; }
                    }
                }
                return true;
            },IntPtr.Zero);
            return chosen;
        }
    }
}
