//go:build desktop

package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
	updaternative "github.com/egoist/mygo/plugins/updater/native"
	"github.com/zxh326/kite/desktoplocales"
	"github.com/zxh326/kite/internal"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/portforward"
	"github.com/zxh326/kite/pkg/version"
	"k8s.io/klog/v2"
)

type DesktopCommand struct {
	Action string `json:"action"`
	Config string `json:"config,omitempty"`
	Path   string `json:"path,omitempty"`
	Error  string `json:"error,omitempty"`
}

type KubeconfigFile struct {
	Path   string `json:"path"`
	Config string `json:"config"`
}

var desktopCommands = mygo.NewEvent[DesktopCommand]("desktop-command")

//go:embed ui/src/assets/tray-icon.png
var trayIcon []byte

//go:embed ui/src/assets/desktop-icon.png
var desktopIcon []byte

type DesktopService struct {
	shellEnv       []string
	path           string
	kubectlWindows map[string]*mygo.Window
	kubectlConfigs map[string]string
}

var desktopService = &DesktopService{
	kubectlWindows: make(map[string]*mygo.Window),
	kubectlConfigs: make(map[string]string),
}

func (*DesktopService) PickKubeconfig(ctx context.Context, title string) (KubeconfigFile, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: title, ShowHiddenFiles: true})
	if err != nil || len(paths) == 0 {
		return KubeconfigFile{}, err
	}
	content, err := os.ReadFile(paths[0])
	return KubeconfigFile{Path: paths[0], Config: string(content)}, err
}

func (s *DesktopService) ImportKubeconfig(path string) (int64, error) {
	count, err := internal.ImportKubeconfigFile(path)
	if err == nil {
		s.syncKubectlConfigs()
	}
	return count, err
}

func (*DesktopService) KubeconfigSources() ([]model.KubeconfigSource, error) {
	sources := make([]model.KubeconfigSource, 0)
	err := model.DB.Where("enabled = ?", true).Order("id").Find(&sources).Error
	return sources, err
}

func (s *DesktopService) RemoveKubeconfigSource(id uint) error {
	err := internal.RemoveKubeconfigSource(id)
	if err == nil {
		s.syncKubectlConfigs()
	}
	return err
}

func (*DesktopService) SaveText(ctx context.Context, title, filename, content string) error {
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: title, DefaultPath: filepath.Base(filename)})
	if err != nil || path == "" {
		return err
	}
	return os.WriteFile(path, []byte(content), 0600)
}

func (*DesktopService) SetDisplayScale(scale int) {
	if scale < 80 || scale > 125 {
		return
	}
	for _, window := range mygo.Windows() {
		if page := window.Page(); page != nil {
			page.SetZoomFactor(float64(scale) / 100)
		}
	}
}

func (*DesktopService) SetLanguage(language string) {
	switch language {
	case "en":
		mygo.App.SetLocale("en")
	case "zh":
		mygo.App.SetLocale("zh-Hans")
	}
}

func main() {
	klog.InitFlags(nil)
	flag.Parse()
	mygo.App.SetName("Kite")
	if desktopVersion := mygo.App.Version(); desktopVersion != "" {
		version.Version = desktopVersion
	}
	dataDir, err := mygo.App.Path(mygo.PathAppData)
	if err != nil {
		log.Fatal(err)
	}
	mygo.App.SetPath(mygo.PathUserData, filepath.Join(dataDir, "Kite"))
	mygo.Bind(desktopService)
	mygo.Use(updaternative.New(updater.Options{Icon: desktopIcon}))
	if os.Getenv("MYGO_GENERATE") != "" {
		if err := mygo.App.Run(); err != nil {
			log.Fatal(err)
		}
		return
	}
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
	shellEnv := os.Environ()
	dataDir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return err
	}
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
	paths := []string{os.Getenv("PATH")}
	if runtime.GOOS == "darwin" {
		paths = append(paths, "/opt/homebrew/bin", "/usr/local/bin", filepath.Join(home, ".krew", "bin"), filepath.Join(home, ".local", "bin"))
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
		"ENABLE_ANALYTICS":       "true",
		"DISABLE_VERSION_CHECK":  "true",
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
	if err := internal.StartKubeconfigWatcher(ctx, desktopService.syncKubectlConfigs); err != nil {
		return err
	}

	engine := buildEngine(cm)
	desktopService.shellEnv = shellEnv
	desktopService.path = path
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

	desktopPage := mygo.PageOptions{PreloadScript: `
		window.__kiteDesktop = true;
		document.addEventListener('contextmenu', (event) => {
			const target = event.target;
			if (target instanceof Element && !target.closest('a[href], input, textarea') && !target.isContentEditable) {
				event.preventDefault();
			}
		});
	`, TrustedOrigins: []string{origin}, ZoomFactor: 0.9}
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
		if page == nil {
			return
		}
		page.OnContextMenu(func(event *mygo.ContextMenuEvent) {
			if event.LinkURL == "" || event.Editable {
				return
			}
			var items []*mygo.MenuItem
			for _, item := range event.Menu.Items() {
				if item.ID == mygo.ContextMenuOpenLink || item.ID == mygo.ContextMenuOpenLinkInNewWindow {
					items = append(items, item)
				}
			}
			event.Menu = mygo.NewMenu(items)
		})
		window.OnReadyToShow(func() { window.Show() })
		page.SetWindowOpenHandler(func(req mygo.WindowOpenRequest) *mygo.WindowOptions {
			target, err := url.Parse(req.URL)
			if err != nil || (target.Scheme != "http" && target.Scheme != "https") {
				return nil
			}
			if target.Scheme+"://"+target.Host == origin {
				if target.Path == common.Base+"/ai-chat-box" {
					if aiWindow != nil {
						aiWindow.Show()
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
						Hidden:    true,
						Page:      desktopPage,
					}
				}
				if target.Path == common.Base+"/desktop/workspace" {
					query := target.Query()
					view := query.Get("view")
					if query.Get("cluster") == "" || (view != "logs" && view != "terminal") {
						return nil
					}
					if query.Get("namespace") == "" || query.Get("name") == "" {
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
						StateKey: key, Page: desktopPage, Hidden: true,
					}
				}
				if window == aiWindow && target.Path == common.Base+"/settings" && mainWindow != nil {
					mainWindow.Page().LoadURL(req.URL)
					showMain()
					return nil
				}
				if strings.HasPrefix(target.Path, common.Base+"/api/") {
					return &mygo.WindowOptions{Title: "Kite", Width: 1100, Height: 800, Page: desktopPage, Hidden: true}
				}
				childPage := desktopPage
				childPage.PreloadScript += "; window.__kiteDesktopChild = true"
				return &mygo.WindowOptions{
					Title: "Kite", Width: 1100, Height: 800, Page: childPage, Hidden: true,
					TitleBarStyle: mygo.TitleBarHidden, TrafficLightPosition: &mygo.Point{X: 14, Y: 17},
					BackgroundColor: "light-dark(#ffffff, #171717)",
				}
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
			Hidden:               true,
			Page:                 desktopPage,
			TitleBarStyle:        mygo.TitleBarHidden,
			TrafficLightPosition: &mygo.Point{X: 14, Y: 17},
			BackgroundColor:      "light-dark(#ffffff, #171717)",
		})
		mainWindow.OnFileDrop(func(event *mygo.FileDropEvent) {
			if len(event.Paths) == 0 {
				return
			}
			window := mainWindow
			go func() {
				content, err := os.ReadFile(event.Paths[0])
				command := DesktopCommand{Action: "import-kubeconfig", Config: string(content), Path: event.Paths[0]}
				if err != nil {
					command.Error = err.Error()
				}
				_ = desktopCommands.Emit(window, command)
			}()
		})
		mainWindow.OnClose(func(event *mygo.CloseEvent) {
			if !quitting {
				event.PreventDefault()
				mainWindow.Hide()
			}
		})
		mainWindow.OnClosed(func() { mainWindow = nil })
	})
	command := func(action string) func(*mygo.MenuItem, *mygo.Window) {
		return func(*mygo.MenuItem, *mygo.Window) {
			showMain()
			if mainWindow != nil {
				_ = desktopCommands.Emit(mainWindow, DesktopCommand{Action: action})
			}
		}
	}
	zoomCommand := func(action string) func(*mygo.MenuItem, *mygo.Window) {
		return func(_ *mygo.MenuItem, window *mygo.Window) {
			if window != nil && window.Page() != nil {
				_ = desktopCommands.Emit(window, DesktopCommand{Action: action})
			}
		}
	}
	updateMenu := func() {
		appMenu := &mygo.MenuItem{Role: mygo.RoleAppMenu}
		if runtime.GOOS == "darwin" {
			appMenu.Submenu = []*mygo.MenuItem{
				{Role: mygo.RoleAbout}, updater.MenuItem(), mygo.Separator(),
				{Role: mygo.RoleServices}, mygo.Separator(),
				{Role: mygo.RoleHide}, {Role: mygo.RoleHideOthers}, {Role: mygo.RoleUnhide},
				mygo.Separator(), {Role: mygo.RoleQuit},
			}
		}
		viewItems := []*mygo.MenuItem{
			{Label: desktoplocales.OpenAI(), Click: command("open-ai")},
			{Label: desktoplocales.ManagePortForwards(), Click: command("port-forwards")},
		}
		if runtime.GOOS != "darwin" {
			viewItems = append(viewItems, updater.MenuItem())
		}
		viewItems = append(viewItems,
			mygo.Separator(),
			&mygo.MenuItem{Label: desktoplocales.ZoomIn(), Accelerator: "CmdOrCtrl+Plus", Click: zoomCommand("zoom-in")},
			&mygo.MenuItem{Label: desktoplocales.ZoomOut(), Accelerator: "CmdOrCtrl+-", Click: zoomCommand("zoom-out")},
			&mygo.MenuItem{Label: desktoplocales.ActualSize(), Accelerator: "CmdOrCtrl+0", Click: zoomCommand("zoom-reset")},
			mygo.Separator(), &mygo.MenuItem{Role: mygo.RoleReload}, &mygo.MenuItem{Role: mygo.RoleToggleFullScreen},
		)
		mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
			appMenu,
			{Label: desktoplocales.File(), Submenu: []*mygo.MenuItem{
				{Label: desktoplocales.ImportKubeconfig(), Click: command("import-kubeconfig")},
				mygo.Separator(), {Role: mygo.RoleClose},
			}},
			{Role: mygo.RoleEditMenu},
			{Label: desktoplocales.View(), Submenu: viewItems},
			{Role: mygo.RoleWindowMenu},
		}))
	}
	mygo.RunOnMain(updateMenu)
	mygo.App.OnLocaleChanged(func(string) { updateMenu() })
	tray, err := mygo.NewTray(mygo.TrayOptions{ID: "kite", Icon: trayIcon, IconIsTemplate: true, ToolTip: "Kite"})
	if err != nil {
		return fmt.Errorf("create menu bar item: %w", err)
	}
	updateTray := func() {
		items := []*mygo.MenuItem{
			{Label: desktoplocales.OpenKite(), Click: func(*mygo.MenuItem, *mygo.Window) { showMain() }},
			{Label: desktoplocales.ManagePortForwards(), Click: command("port-forwards")},
			mygo.Separator(),
		}
		count := 0
		connections := forwards.Snapshot()
		if len(connections) == 0 {
			items = append(items, &mygo.MenuItem{Label: desktoplocales.NoPortForwards(), Disabled: true})
		}
		for _, connection := range connections {
			address := fmt.Sprintf("127.0.0.1:%d", connection.LocalPort)
			label := fmt.Sprintf("%s → %s:%d", address, connection.Name, connection.RemotePort)
			children := []*mygo.MenuItem{{Label: connection.Cluster + " / " + connection.Namespace, Disabled: true}}
			if connection.Status == "active" {
				count++
				children = append(children,
					&mygo.MenuItem{Label: desktoplocales.CopyAddress(), Click: func(*mygo.MenuItem, *mygo.Window) { mygo.Clipboard.WriteText(address) }},
					&mygo.MenuItem{Label: desktoplocales.OpenAsHTTP(), Click: func(*mygo.MenuItem, *mygo.Window) {
						go func() {
							if err := mygo.Shell.OpenExternal("http://" + address); err != nil {
								klog.Errorf("Open forwarded address: %v", err)
							}
						}()
					}},
				)
			} else {
				label += desktoplocales.Disconnected()
				if connection.Error != "" {
					children = append(children, &mygo.MenuItem{Label: connection.Error, Disabled: true})
				}
			}
			stopLabel := desktoplocales.Stop()
			if connection.Status != "active" {
				stopLabel = desktoplocales.Remove()
			}
			children = append(children, &mygo.MenuItem{Label: stopLabel, Click: func(*mygo.MenuItem, *mygo.Window) {
				go forwards.StopLocal(connection.ID)
			}})
			items = append(items, &mygo.MenuItem{Label: label, Submenu: children})
		}
		items = append(items, mygo.Separator(), &mygo.MenuItem{Label: desktoplocales.QuitKite(), Role: mygo.RoleQuit})
		tray.SetMenu(mygo.NewMenu(items))
		title := ""
		if count > 0 {
			title = strconv.Itoa(count)
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
