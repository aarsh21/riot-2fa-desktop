$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class SnapshotNative {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out Rect r, int size);
}
'@
[void][SnapshotNative]::SetProcessDpiAwarenessContext([IntPtr](-4))
[void][SnapshotNative]::SetThreadDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Emit($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
function Save-Window {
  $handle = [SnapshotNative]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero -or [SnapshotNative]::IsIconic($handle)) { throw 'No visible window' }
  $r = New-Object SnapshotNative+Rect
  if ([SnapshotNative]::DwmGetWindowAttribute($handle, 9, [ref]$r, 16) -ne 0) {
    if (-not [SnapshotNative]::GetWindowRect($handle, [ref]$r)) { throw 'Window bounds unavailable' }
  }
  $rect = [System.Drawing.Rectangle]::FromLTRB($r.Left, $r.Top, $r.Right, $r.Bottom)
  $rect = [System.Drawing.Rectangle]::Intersect($rect, [System.Windows.Forms.SystemInformation]::VirtualScreen)
  if ($rect.Width -le 0 -or $rect.Height -le 0 -or ([long]$rect.Width * $rect.Height) -gt 40000000) { throw 'Invalid capture dimensions' }
  $bitmap = New-Object System.Drawing.Bitmap($rect.Width, $rect.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Location, [System.Drawing.Point]::Empty, $rect.Size)
    $file = [Guid]::NewGuid().ToString() + '.png'
    $bitmap.Save((Join-Path $env:RIOT2FA_SNAPSHOT_DIR $file), [System.Drawing.Imaging.ImageFormat]::Png)
    if ($env:RIOT2FA_SNAPSHOT_MODE -eq 'selftest') {
      $bitmap.Save((Join-Path ([System.IO.Path]::GetDirectoryName($env:RIOT2FA_SNAPSHOT_FIXTURE)) 'captured.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    Emit @{ type = 'capture'; file = $file }
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
try {
  switch ($env:RIOT2FA_SNAPSHOT_MODE) {
    'watch' {
      Emit @{ type = 'ready' }
      $previous = $true
      $heartbeat = [DateTime]::UtcNow
      while (Get-Process -Id ([int]$env:RIOT2FA_PARENT_PID) -ErrorAction SilentlyContinue) {
        $pressed = (([SnapshotNative]::GetAsyncKeyState(0xA0) -band 0x8000) -ne 0) -and (([SnapshotNative]::GetAsyncKeyState(0xA1) -band 0x8000) -ne 0)
        if ($pressed -and -not $previous) {
          try { Save-Window } catch { Emit @{ type = 'error'; message = 'The active window could not be captured.' } }
        }
        $previous = $pressed
        if (([DateTime]::UtcNow - $heartbeat).TotalSeconds -gt 2) { Emit @{ type = 'heartbeat' }; $heartbeat = [DateTime]::UtcNow }
        Start-Sleep -Milliseconds 50
      }
    }
    'region' {
      $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
      if (([long]$bounds.Width * $bounds.Height) -gt 40000000) { throw 'Display is too large' }
      $desktop = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($desktop)
      $overlay = New-Object System.Windows.Forms.Form
      try {
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $overlay.FormBorderStyle = 'None'
        $overlay.StartPosition = 'Manual'
        $overlay.Bounds = $bounds
        $overlay.TopMost = $true
        $overlay.ShowInTaskbar = $false
        $overlay.KeyPreview = $true
        $overlay.Cursor = [System.Windows.Forms.Cursors]::Cross
        $overlay.BackgroundImage = $desktop
        $overlay.BackgroundImageLayout = 'None'
        $script:selectionStart = $null
        $script:selectionEnd = $null
        $script:selectionResult = $null
        $overlay.Add_KeyDown({ if ($_.KeyCode -eq 'Escape') { $this.Close() } })
        $overlay.Add_MouseDown({
          if ($_.Button -eq 'Right') { $this.Close(); return }
          $script:selectionStart = $_.Location; $script:selectionEnd = $_.Location
          $this.Capture = $true
        })
        $overlay.Add_MouseMove({ if ($null -ne $script:selectionStart) { $script:selectionEnd = $_.Location; $this.Invalidate() } })
        $overlay.Add_Paint({
          if ($null -eq $script:selectionStart) { return }
          $x = [Math]::Min($script:selectionStart.X, $script:selectionEnd.X)
          $y = [Math]::Min($script:selectionStart.Y, $script:selectionEnd.Y)
          $w = [Math]::Abs($script:selectionStart.X - $script:selectionEnd.X)
          $h = [Math]::Abs($script:selectionStart.Y - $script:selectionEnd.Y)
          $_.Graphics.DrawRectangle([System.Drawing.Pens]::White, $x, $y, $w, $h)
          if ($w -gt 2 -and $h -gt 2) { $_.Graphics.DrawRectangle([System.Drawing.Pens]::Black, $x + 1, $y + 1, $w - 2, $h - 2) }
        })
        $overlay.Add_MouseUp({
          if ($null -eq $script:selectionStart -or $_.Button -ne 'Left') { return }
          $script:selectionResult = [System.Drawing.Rectangle]::FromLTRB(
            [Math]::Min($script:selectionStart.X, $_.X), [Math]::Min($script:selectionStart.Y, $_.Y),
            [Math]::Max($script:selectionStart.X, $_.X), [Math]::Max($script:selectionStart.Y, $_.Y))
          $this.Close()
        })
        $timeout = New-Object System.Windows.Forms.Timer
        $timeout.Interval = 60000
        $timeout.Add_Tick({ $overlay.Close() })
        $timeout.Start()
        try { [void]$overlay.ShowDialog() } finally { $timeout.Stop(); $timeout.Dispose() }
        if ($null -eq $script:selectionResult) { Emit @{ type = 'cancelled' }; exit 0 }
        $selection = [System.Drawing.Rectangle]::Intersect($script:selectionResult, (New-Object System.Drawing.Rectangle(0, 0, $bounds.Width, $bounds.Height)))
        if ($selection.Width -lt 2 -or $selection.Height -lt 2) { Emit @{ type = 'cancelled' }; exit 0 }
        $image = $desktop.Clone($selection, $desktop.PixelFormat)
        try {
          $file = [Guid]::NewGuid().ToString() + '.png'
          $image.Save((Join-Path $env:RIOT2FA_SNAPSHOT_DIR $file), [System.Drawing.Imaging.ImageFormat]::Png)
          Emit @{ type = 'capture'; file = $file }
        } finally { $image.Dispose() }
      } finally { $overlay.Dispose(); $graphics.Dispose(); $desktop.Dispose() }
    }
    'selftest' {
      $form = New-Object System.Windows.Forms.Form
      $form.Text = 'Riot 2FA snapshot test'
      $form.ClientSize = New-Object System.Drawing.Size(400, 400)
      $form.StartPosition = 'CenterScreen'
      $form.TopMost = $true
      $picture = New-Object System.Windows.Forms.PictureBox
      $picture.Dock = 'Fill'
      $picture.SizeMode = 'CenterImage'
      $picture.Image = [System.Drawing.Image]::FromFile($env:RIOT2FA_SNAPSHOT_FIXTURE)
      $form.Controls.Add($picture)
      try {
        $form.Show()
        [void][SnapshotNative]::ShowWindow($form.Handle, 5)
        [void][SnapshotNative]::SetForegroundWindow($form.Handle)
        $form.BringToFront(); $form.Activate(); $form.Refresh(); $picture.Refresh()
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 500
        [System.Windows.Forms.Application]::DoEvents()
        if ([SnapshotNative]::GetForegroundWindow() -ne $form.Handle) { throw 'The test window could not take focus' }
        if ($env:RIOT2FA_SNAPSHOT_TEST_SHORTCUT -eq '1') {
          try {
            [SnapshotNative]::keybd_event(0xA0, 0x2A, 0, [UIntPtr]::Zero)
            [SnapshotNative]::keybd_event(0xA1, 0x36, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 1000
          } finally {
            [SnapshotNative]::keybd_event(0xA0, 0x2A, 2, [UIntPtr]::Zero)
            [SnapshotNative]::keybd_event(0xA1, 0x36, 2, [UIntPtr]::Zero)
          }
        }
        $form.Refresh(); [System.Windows.Forms.Application]::DoEvents()
        if ([SnapshotNative]::GetForegroundWindow() -ne $form.Handle) { throw 'The test window lost focus' }
        Save-Window
      } finally { $picture.Image.Dispose(); $form.Close(); $form.Dispose() }
    }
    default { Save-Window }
  }
} catch { Emit @{ type = 'error'; message = 'Windows screen capture is unavailable.' }; exit 1 }
