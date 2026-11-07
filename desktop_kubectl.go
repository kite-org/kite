//go:build desktop

package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/terminal"
	"github.com/egoist/mygo/ui"
	"github.com/zxh326/kite/pkg/model"
)

func (s *DesktopService) OpenKubectl(clusterName string) error {
	var result error
	mygo.RunOnMain(func() {
		if window := s.kubectlWindows[clusterName]; window != nil {
			window.Show()
			window.Restore()
			window.Focus()
			return
		}
		cluster, err := model.GetClusterByName(clusterName)
		if err != nil || !cluster.Enable || cluster.InCluster || cluster.ClusterAgent || cluster.Config == "" {
			result = errors.New("desktop.localKubeconfigUnavailable")
			return
		}
		if _, err := exec.LookPath("kubectl"); err != nil {
			result = errors.New("desktop.kubectlNotInstalled")
			return
		}
		config, err := os.CreateTemp("", "kite-kubeconfig-*")
		if err != nil {
			result = errors.New("desktop.localKubeconfigError")
			return
		}
		_, err = config.WriteString(string(cluster.Config))
		closeErr := config.Close()
		if err != nil || closeErr != nil {
			_ = os.Remove(config.Name())
			result = errors.New("desktop.localKubeconfigError")
			return
		}
		opts, err := s.terminalOptions(config.Name())
		if err != nil {
			_ = os.Remove(config.Name())
			result = errors.New("desktop.localTerminalStartError")
			return
		}
		colors := terminal.DarkTheme()
		colors.Background = ui.Hex("#000000")
		colors.Foreground = ui.Hex("#5cdc70")
		colors.Cursor = ui.Hex("#ffffff")
		var window *mygo.Window
		ready := make(chan struct{})
		opts.Theme = colors
		opts.Font = terminal.Font{Family: "Maple Mono, Menlo, monospace", Size: 14}
		opts.Cursor = terminal.CursorBar
		opts.OnExit = func(int) { <-ready; window.Close() }
		term, err := terminal.New(opts)
		if err != nil {
			if opts.Conn != nil {
				_ = opts.Conn.Close()
			}
			_ = os.Remove(config.Name())
			result = errors.New("desktop.localTerminalStartError")
			return
		}
		window = mygo.NewWindow(mygo.WindowOptions{
			Title: "Kubectl · " + clusterName + " - Kite", Width: 1100, Height: 760, MinWidth: 720, MinHeight: 480,
			StateKey: fmt.Sprintf("kubectl-%x", sha256.Sum256([]byte(clusterName))), Hidden: true, TitleBarStyle: mygo.TitleBarHidden,
			TrafficLightPosition: &mygo.Point{X: 14, Y: 17}, BackgroundColor: "light-dark(#ffffff, #171717)",
			Content: ui.View(func(c *ui.Context) {
				bar := c.TitleBar()
				ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
					ui.Row(c).Height(48).FillWidth().Padding(0, bar.Right+12, 0, bar.Left+12).Gap(12).DragWindow().Background(c.Theme().Surface).Children(func() {
						ui.Text(c, "Kubectl").FontSize(14).Bold()
						ui.Text(c, clusterName).FontSize(13).TextColor(c.Theme().TextMuted)
					})
					ui.Box(c).Grow(1).FillWidth().Padding(12).Children(func() {
						terminal.View(c, term).Fill().AutoFocus()
					})
				})
			}),
		})
		window.OnReadyToShow(func() { window.Show() })
		s.kubectlWindows[clusterName] = window
		window.OnClosed(func() {
			delete(s.kubectlWindows, clusterName)
			_ = term.Close()
			_ = os.Remove(config.Name())
		})
		close(ready)
	})
	return result
}
