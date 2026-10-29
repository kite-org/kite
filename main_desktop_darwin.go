//go:build desktop

package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/portforward"
	"github.com/zxh326/kite/pkg/version"
	"k8s.io/klog/v2"
)

func main() {
	klog.InitFlags(nil)
	flag.Parse()
	mygo.App.SetName("Kite MyGo")
	mygo.App.SetVersion(version.Version)
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan error, 1)
	mygo.App.WhenReady(func() {
		go func() {
			err := runDesktop(ctx)
			if err != nil {
				mygo.Dialog.Error("Kite could not start", err.Error())
			}
			finished <- err
			mygo.App.Quit()
		}()
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
	cancel()
	if err := <-finished; err != nil {
		log.Fatal(err)
	}
}

func runDesktop(ctx context.Context) error {
	dataDir, err := mygo.App.Path(mygo.PathAppData)
	if err != nil {
		return err
	}
	dataDir = filepath.Join(dataDir, "Kite MyGo Local")
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return err
	}
	mygo.App.SetPath(mygo.PathUserData, dataDir)
	dbPath := filepath.Join(dataDir, "kite.db")

	keyPath := filepath.Join(dataDir, "encryption.key")
	secret, err := os.ReadFile(keyPath)
	if errors.Is(err, os.ErrNotExist) {
		if _, statErr := os.Stat(dbPath); statErr == nil {
			return fmt.Errorf("the encryption key file is missing; restore %s to open the existing database", keyPath)
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return statErr
		}
		secret = []byte(rand.Text())
		err = os.WriteFile(keyPath, secret, 0600)
	}
	if err != nil {
		return fmt.Errorf("load desktop key file %s: %w", keyPath, err)
	}
	if err := os.Setenv("KITE_ENCRYPT_KEY", string(secret)); err != nil {
		return err
	}

	home, err := mygo.App.Path(mygo.PathHome)
	if err != nil {
		return err
	}
	paths := []string{"/opt/homebrew/bin", "/usr/local/bin", filepath.Join(home, ".krew", "bin"), filepath.Join(home, ".local", "bin")}
	if path := os.Getenv("PATH"); path != "" {
		paths = append([]string{path}, paths...)
	}
	path := strings.Join(paths, string(os.PathListSeparator))
	if err := os.Setenv("PATH", path); err != nil {
		return err
	}

	portPath := filepath.Join(dataDir, "port")
	portData, err := os.ReadFile(portPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	port := 0
	if err == nil {
		port, err = strconv.Atoi(strings.TrimSpace(string(portData)))
		if err != nil || port < 1 || port > 65535 {
			return fmt.Errorf("invalid saved desktop port in %s", portPath)
		}
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return fmt.Errorf("could not listen on desktop port %d: %w", port, err)
	}
	defer listener.Close()
	if port == 0 {
		if err := os.WriteFile(portPath, []byte(strconv.Itoa(listener.Addr().(*net.TCPAddr).Port)), 0600); err != nil {
			return err
		}
	}
	origin := "http://" + listener.Addr().String()
	for name, value := range map[string]string{
		"DB_TYPE":                "sqlite",
		"DB_DSN":                 dbPath,
		"PLUGIN_DIR":             filepath.Join(dataDir, "plugins"),
		"HOST":                   origin,
		"TRUSTED_PROXIES":        "none",
		"ANONYMOUS_USER_ENABLED": "true",
	} {
		if err := os.Setenv(name, value); err != nil {
			return err
		}
	}

	cm, err := initializeApp(ctx)
	if err != nil {
		return err
	}
	localUser := model.User{Username: "anonymous", Provider: "Anonymous", Name: "Local", Enabled: true}
	if err := model.DB.Where("username = ? AND provider = ?", localUser.Username, localUser.Provider).FirstOrCreate(&localUser).Error; err != nil {
		return err
	}
	db, err := model.DB.DB()
	if err != nil {
		return err
	}
	defer db.Close()

	engine := buildEngine(cm)
	forwards := portforward.New(ctx)
	defer forwards.Close()
	forwards.RegisterRoutes(engine, cm)
	sessionToken := rand.Text()
	if err := mygo.Cookies.Set(mygo.Cookie{
		Name: "kite_desktop_session", Value: sessionToken, Domain: "127.0.0.1", Path: "/",
		HTTPOnly: true, SameSite: mygo.CookieSameSiteStrict,
	}); err != nil {
		return errors.New("could not initialize desktop session")
	}
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Host != listener.Addr().String() || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != origin) {
				http.Error(w, "Forbidden", http.StatusForbidden)
				return
			}
			cookie, err := r.Cookie("kite_desktop_session")
			if err != nil || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(sessionToken)) != 1 {
				http.Error(w, "Forbidden", http.StatusForbidden)
				return
			}
			path := strings.TrimPrefix(r.URL.Path, common.Base)
			if strings.HasPrefix(path, "/api/auth/") || strings.HasPrefix(path, "/api/users/me") ||
				strings.HasPrefix(path, "/api/v1/admin/oauth-providers") || strings.HasPrefix(path, "/api/v1/admin/ldap-setting") ||
				strings.HasPrefix(path, "/api/v1/admin/roles") || strings.HasPrefix(path, "/api/v1/admin/users") ||
				strings.HasPrefix(path, "/api/v1/admin/apikeys") {
				http.NotFound(w, r)
				return
			}
			engine.ServeHTTP(w, r)
		}),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	defer func() {
		shutdownCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if err := server.Shutdown(shutdownCtx); err != nil {
			klog.Errorf("Failed to stop desktop server: %v", err)
		}
	}()
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			klog.Errorf("Desktop server failed: %v", err)
			mygo.App.Quit()
		}
	}()
	klog.Infof("Kite desktop listening on %s", origin)

	desktopPage := mygo.PageOptions{PreloadScript: "window.__kiteDesktop = true"}
	var mainWindow *mygo.Window
	var aiWindow *mygo.Window
	workspaces := make(map[string]*mygo.Window)
	creatingWindow := ""
	quitting := false
	showMain := func() {
		if mainWindow != nil {
			mainWindow.Show()
			mainWindow.Restore()
			mainWindow.Focus()
		}
	}
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { quitting = true })
	mygo.App.OnWindowCreated(func(window *mygo.Window) {
		key := creatingWindow
		creatingWindow = ""
		if key == "ai-chat" {
			aiWindow = window
			window.OnClosed(func() { aiWindow = nil })
		} else if key != "" {
			workspaces[key] = window
			window.OnClosed(func() { delete(workspaces, key) })
		}
		page := window.Page()
		page.SetWindowOpenHandler(func(req mygo.WindowOpenRequest) *mygo.WindowOptions {
			target, err := url.Parse(req.URL)
			if err != nil || (target.Scheme != "http" && target.Scheme != "https") {
				return nil
			}
			if target.Scheme+"://"+target.Host == origin {
				if target.Path == common.Base+"/ai-chat-box" {
					if aiWindow != nil {
						aiWindow.Restore()
						aiWindow.Focus()
						return nil
					}
					// MyGo creates the window after this handler returns.
					creatingWindow = "ai-chat"
					return &mygo.WindowOptions{
						Title:     "Kite AI",
						Width:     560,
						Height:    800,
						MinWidth:  380,
						MinHeight: 480,
						StateKey:  "ai-chat",
						Page:      desktopPage,
					}
				}
				if target.Path == common.Base+"/desktop/workspace" {
					query := target.Query()
					view := query.Get("view")
					if query.Get("cluster") == "" || (view != "logs" && view != "terminal" && view != "kubectl") {
						return nil
					}
					if view != "kubectl" && (query.Get("namespace") == "" || query.Get("name") == "") {
						return nil
					}
					key := fmt.Sprintf("workspace-%x", sha256.Sum256([]byte(query.Encode())))
					if existing := workspaces[key]; existing != nil {
						existing.Show()
						existing.Restore()
						existing.Focus()
						return nil
					}
					creatingWindow = key
					return &mygo.WindowOptions{
						Title: "Kite", Width: 1100, Height: 760, MinWidth: 720, MinHeight: 480,
						StateKey: key, Page: desktopPage,
					}
				}
				if window == aiWindow && target.Path == common.Base+"/settings" && mainWindow != nil {
					mainWindow.Page().LoadURL(req.URL)
					showMain()
					return nil
				}
				return &mygo.WindowOptions{Title: "Kite", Width: 1100, Height: 800, Page: desktopPage}
			}
			go func() {
				if err := mygo.Shell.OpenExternal(req.URL); err != nil {
					klog.Errorf("Failed to open external link: %v", err)
				}
			}()
			return nil
		})
		page.OnWillNavigate(func(event *mygo.NavigateEvent) {
			target, err := url.Parse(event.URL)
			if err != nil || (target.Scheme != "http" && target.Scheme != "https" && target.Scheme != "blob") {
				event.PreventDefault()
			} else if target.Scheme != "blob" && target.Scheme+"://"+target.Host != origin {
				event.PreventDefault()
				go func() {
					if err := mygo.Shell.OpenExternal(event.URL); err != nil {
						klog.Errorf("Failed to open external link: %v", err)
					}
				}()
			}
		})
	})
	mygo.App.OnSecondInstance(func(_ []string, _ string) { showMain() })
	mygo.App.OnActivate(func(hasVisibleWindows bool) {
		if !hasVisibleWindows {
			showMain()
		}
	})
	mygo.App.WhenReady(func() {
		mainWindow = mygo.NewWindow(mygo.WindowOptions{
			Title:                "Kite",
			URL:                  origin + common.Base + "/",
			Width:                1440,
			Height:               960,
			MinWidth:             960,
			MinHeight:            640,
			StateKey:             "main",
			Page:                 desktopPage,
			TitleBarStyle:        mygo.TitleBarHidden,
			TrafficLightPosition: &mygo.Point{X: 14, Y: 17},
			BackgroundColor:      "light-dark(#ffffff, #171717)",
		})
		mainWindow.OnClose(func(event *mygo.CloseEvent) {
			if !quitting {
				event.PreventDefault()
				mainWindow.Hide()
			}
		})
		mainWindow.OnClosed(func() { mainWindow = nil })
	})
	tray, err := mygo.NewTray(mygo.TrayOptions{ID: "kite", Title: "Kite", ToolTip: "Kite"})
	if err != nil {
		return fmt.Errorf("create menu bar item: %w", err)
	}
	updateTray := func() {
		text := func(en, zh string) string {
			if strings.HasPrefix(mygo.App.Locale(), "zh") {
				return zh
			}
			return en
		}
		items := []*mygo.MenuItem{
			{Label: text("Open Kite", "打开 Kite"), Click: func(*mygo.MenuItem, *mygo.Window) { showMain() }},
			{Label: text("Manage port forwards…", "管理端口转发…"), Click: func(*mygo.MenuItem, *mygo.Window) {
				showMain()
				if mainWindow != nil {
					page := mainWindow.Page()
					go func() {
						if _, err := page.Eval("window.location.hash = 'port-forwards'"); err != nil {
							klog.Errorf("Open port forward manager: %v", err)
						}
					}()
				}
			}},
			mygo.Separator(),
		}
		count := 0
		connections := forwards.Snapshot()
		if len(connections) == 0 {
			items = append(items, &mygo.MenuItem{Label: text("No port forwards", "暂无端口转发"), Disabled: true})
		}
		for _, connection := range connections {
			address := fmt.Sprintf("127.0.0.1:%d", connection.LocalPort)
			label := fmt.Sprintf("%s → %s:%d", address, connection.Name, connection.RemotePort)
			children := []*mygo.MenuItem{{Label: connection.Cluster + " / " + connection.Namespace, Disabled: true}}
			if connection.Status == "active" {
				count++
				children = append(children,
					&mygo.MenuItem{Label: text("Copy address", "复制地址"), Click: func(*mygo.MenuItem, *mygo.Window) { mygo.Clipboard.WriteText(address) }},
					&mygo.MenuItem{Label: text("Open as HTTP", "以 HTTP 打开"), Click: func(*mygo.MenuItem, *mygo.Window) {
						go func() {
							if err := mygo.Shell.OpenExternal("http://" + address); err != nil {
								klog.Errorf("Open forwarded address: %v", err)
							}
						}()
					}},
				)
			} else {
				label += text(" (disconnected)", "（已断开）")
				if connection.Error != "" {
					children = append(children, &mygo.MenuItem{Label: connection.Error, Disabled: true})
				}
			}
			stopLabel := text("Stop", "停止")
			if connection.Status != "active" {
				stopLabel = text("Remove", "移除")
			}
			children = append(children, &mygo.MenuItem{Label: stopLabel, Click: func(*mygo.MenuItem, *mygo.Window) {
				go forwards.StopLocal(connection.ID)
			}})
			items = append(items, &mygo.MenuItem{Label: label, Submenu: children})
		}
		items = append(items, mygo.Separator(), &mygo.MenuItem{Label: text("Quit Kite", "退出 Kite"), Role: mygo.RoleQuit})
		tray.SetMenu(mygo.NewMenu(items))
		title := "Kite"
		if count > 0 {
			title = fmt.Sprintf("Kite · %d", count)
		}
		tray.SetTitle(title)
	}
	mygo.RunOnMain(updateTray)
	mygo.App.OnLocaleChanged(func(string) { updateTray() })
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-forwards.Changes():
				mygo.RunOnMain(updateTray)
			}
		}
	}()
	<-ctx.Done()
	return nil
}
