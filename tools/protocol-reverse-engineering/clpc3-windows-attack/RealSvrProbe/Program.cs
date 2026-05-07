using System;
using System.ComponentModel;
using System.Windows.Forms;
using AxRealSvrOcxTcpLib;

namespace RealSvrProbe;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var port = args.Length > 0 && int.TryParse(args[0], out var parsedPort) ? parsedPort : 18080;
        var seconds = args.Length > 1 && int.TryParse(args[1], out var parsedSeconds) ? parsedSeconds : 120;

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        using var form = new Form
        {
            Text = "RealSvrProbe",
            ShowInTaskbar = false,
            WindowState = FormWindowState.Minimized,
            Opacity = 0,
            Width = 1,
            Height = 1,
        };

        var ax = new AxRealSvrOcxTcp();
        ((ISupportInitialize)ax).BeginInit();
        form.Controls.Add(ax);
        ((ISupportInitialize)ax).EndInit();

        ax.OnReceiveGLogData += (_, e) =>
        {
            Console.WriteLine($"[{Stamp()}] EVENT OnReceiveGLogData");
            Console.WriteLine($"  device={e.astrDeviceIP}:{e.anDevicePort} id={e.anDeviceID} enroll={e.anSEnrollNumber} verify={e.anVerifyMode} inout={e.anInOutMode} logDate={e.anLogDate:o} serial={e.astrSerialNo}");
        };

        ax.OnReceiveGLogDataExtend += (_, e) =>
        {
            Console.WriteLine($"[{Stamp()}] EVENT OnReceiveGLogDataExtend");
            Console.WriteLine($"  root={e.astrRootIP} device={e.astrDeviceIP}:{e.anDevicePort} id={e.anDeviceID} enroll={e.anSEnrollNumber} verify={e.anVerifyMode} inout={e.anInOutMode} logDate={e.anLogDate:o} serial={e.astrSerialNo}");
        };

        ax.OnReceiveGLogText += (_, e) =>
        {
            Console.WriteLine($"[{Stamp()}] EVENT OnReceiveGLogText");
            Console.WriteLine($"  client={e.astrClientIP}:{e.anClientPort}");
            Console.WriteLine($"  text={e.astrLogText}");
            SendResponses(ax, e.astrClientIP, e.anClientPort);
        };

        ax.OnReceiveGLogTextAndImage += (_, e) =>
        {
            Console.WriteLine($"[{Stamp()}] EVENT OnReceiveGLogTextAndImage");
            Console.WriteLine($"  client={e.astrClientIP}:{e.anClientPort}");
            Console.WriteLine($"  text={e.astrLogText}");
            Console.WriteLine($"  imageLen={e.astrLogImage?.Length ?? 0}");
            SendResponses(ax, e.astrClientIP, e.anClientPort);
        };

        ax.OnReceiveGLogTextOnDoorOpen += (_, e) =>
        {
            Console.WriteLine($"[{Stamp()}] EVENT OnReceiveGLogTextOnDoorOpen");
            Console.WriteLine($"  client={e.astrClientIP}:{e.anClientPort}");
            Console.WriteLine($"  text={e.astrLogText}");
            Console.WriteLine($"  imageLen={e.astrLogImage?.Length ?? 0}");
            SendResponses(ax, e.astrClientIP, e.anClientPort);
        };

        form.Load += (_, _) =>
        {
            Console.WriteLine($"[{Stamp()}] OpenNetwork({port})");
            try
            {
                Console.WriteLine($"[{Stamp()}] OpenNetwork => {ax.OpenNetwork(port)}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[{Stamp()}] OpenNetwork error: {ex}");
                form.Close();
                return;
            }

            var timer = new System.Windows.Forms.Timer { Interval = seconds * 1000 };
            timer.Tick += (_, _) =>
            {
                timer.Stop();
                Console.WriteLine($"[{Stamp()}] CloseNetwork({port}) => {ax.CloseNetwork(port)}");
                form.Close();
            };
            timer.Start();
            Console.WriteLine($"[{Stamp()}] Listening for {seconds}s");
        };

        Application.Run(form);
    }

    private static void SendResponses(AxRealSvrOcxTcp ax, string clientIp, int clientPort)
    {
        foreach (var body in new[] { "OK", "ok", "1" })
        {
            TrySend("SendResponse", body, () => ax.SendResponse(clientIp, clientPort, body));
            TrySend("SendRtLogResponseV1", body, () => ax.SendRtLogResponseV1(clientIp, clientPort, body));
            TrySend("SendRtLogResponseV3", body, () => ax.SendRtLogResponseV3(clientIp, clientPort, body));
        }
    }

    private static void TrySend(string name, string body, Func<int> send)
    {
        try
        {
            Console.WriteLine($"  {name}({body}) => {send()}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  {name}({body}) error: {ex.Message}");
        }
    }

    private static string Stamp() => DateTime.Now.ToString("HH:mm:ss.fff");
}
