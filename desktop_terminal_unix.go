//go:build desktop && (darwin || linux)

package main

import (
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/creack/pty"
	"github.com/egoist/mygo/plugins/terminal"
)

type desktopTerminal struct {
	*os.File
	cmd *exec.Cmd
}

func (t *desktopTerminal) Resize(cols, rows int) error {
	return pty.Setsize(t.File, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

func (t *desktopTerminal) Close() error {
	err := t.File.Close()
	_ = t.cmd.Process.Kill()
	_ = t.cmd.Wait()
	return err
}

func (s *DesktopService) terminalOptions(configPath string) (terminal.Options, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
		if runtime.GOOS == "linux" {
			shell = "/bin/sh"
		}
	}
	cmd := exec.Command(shell, "-i")
	cmd.Dir, _ = os.UserHomeDir()
	for _, value := range s.shellEnv {
		if !strings.HasPrefix(value, "KITE_ENCRYPT_KEY=") {
			cmd.Env = append(cmd.Env, value)
		}
	}
	cmd.Env = append(cmd.Env, "PATH="+s.path, "KUBECONFIG="+configPath, "TERM=xterm-256color", "COLORTERM=truecolor")
	file, err := pty.Start(cmd)
	if err != nil {
		return terminal.Options{}, err
	}
	return terminal.Options{Conn: &desktopTerminal{File: file, cmd: cmd}}, nil
}
