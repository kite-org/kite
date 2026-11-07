//go:build desktop

package main

import "github.com/egoist/mygo/plugins/terminal"

func (s *DesktopService) terminalOptions(configPath string) (terminal.Options, error) {
	return terminal.Options{Env: []string{"KUBECONFIG=" + configPath, "KITE_ENCRYPT_KEY="}}, nil
}
