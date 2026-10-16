Option Explicit
Dim sh, fso, jsPath, nodePath, exec, line, ARG
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
jsPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "leigod_pause.js")

Function FindNode()
  Dim arr, x
  arr = Array( _
    "D:\devTool\node20.11.1\node.exe", _
    "D:\devTool\node22\dist\node.exe", _
    "C:\Program Files\nodejs\node.exe", _
    "C:\Program Files (x86)\nodejs\node.exe")
  FindNode = ""
  For Each x In arr
    If fso.FileExists(x) Then
      FindNode = x
      Exit Function
    End If
  Next
  On Error Resume Next
  Err.Clear
  Set exec = sh.Exec("cmd /c where node")
  If Err.Number = 0 Then
    Do While Not exec.StdOut.AtEndOfStream
      line = exec.StdOut.ReadLine()
      If Len(line) > 0 And fso.FileExists(line) Then
        FindNode = line
        Exit Function
      End If
    Loop
  End If
  Err.Clear
  Set exec = sh.Exec("powershell -NoProfile -Command ""(Get-Command node).Source""")
  If Err.Number = 0 Then
    Do While Not exec.StdOut.AtEndOfStream
      line = Trim(exec.StdOut.ReadLine())
      If Len(line) > 0 And fso.FileExists(line) Then
        FindNode = line
        Exit Function
      End If
    Loop
  End If
  On Error GoTo 0
  FindNode = ""
End Function

nodePath = FindNode()
If nodePath = "" Then WScript.Quit 1
If Not fso.FileExists(jsPath) Then WScript.Quit 2
ARG = "watch --auto-recover"
sh.Run """" & nodePath & """ """ & jsPath & """ " & ARG, 0, False
