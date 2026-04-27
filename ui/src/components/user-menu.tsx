import { useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import {
  CaseSensitive,
  Check,
  LogOut,
  Minus,
  Palette,
  Plus,
  ZoomIn,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useAppearance } from '@/components/appearance-provider'
import { ColorTheme, colorThemes } from '@/components/color-theme-provider'

import { SidebarCustomizer } from './sidebar-customizer'

const DISPLAY_SCALE_MIN = 80
const DISPLAY_SCALE_MAX = 120
const DISPLAY_SCALE_STEP = 5

export function UserMenu() {
  const { user, logout, hasGlobalSidebarPreference } = useAuth()
  const {
    colorTheme,
    setColorTheme,
    displayScale,
    setDisplayScale,
    font,
    setFont,
  } = useAppearance()
  const [open, setOpen] = useState(false)
  const [scaleInput, setScaleInput] = useState(String(displayScale))

  if (!user) return null

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleLogout = async () => {
    try {
      await logout()
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  const handleDisplayScaleChange = (nextDisplayScale: number) => {
    const clampedDisplayScale = Math.min(
      DISPLAY_SCALE_MAX,
      Math.max(DISPLAY_SCALE_MIN, nextDisplayScale)
    )
    const normalizedDisplayScale =
      Math.round(clampedDisplayScale / DISPLAY_SCALE_STEP) * DISPLAY_SCALE_STEP
    setScaleInput(String(normalizedDisplayScale))
    setDisplayScale(normalizedDisplayScale)
  }

  const commitScaleInput = () => {
    if (scaleInput.trim() === '') {
      setScaleInput(String(displayScale))
      return
    }

    const nextDisplayScale = Number(scaleInput)

    if (!Number.isFinite(nextDisplayScale)) {
      setScaleInput(String(displayScale))
      return
    }

    handleDisplayScaleChange(nextDisplayScale)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-10 w-10 rounded-full">
          <Avatar className="size-sm">
            <AvatarImage
              src={user.avatar_url}
              alt={user.name || user.username}
            />
            <AvatarFallback className="bg-primary text-primary-foreground">
              {getInitials(user.name || user.username)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <div className="flex items-center justify-start gap-2 p-2">
          <div className="flex flex-col space-y-1 leading-none">
            {user.name && <p className="font-medium">{user.name}</p>}
            <p className="text-xs text-muted-foreground">{user.username}</p>
            {user.provider && (
              <p className="text-xs text-muted-foreground capitalize">
                via {user.provider}
              </p>
            )}
            {user.roles && user.roles.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Role: {user.roles.map((role) => role.name).join(', ')}
              </p>
            )}
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="mr-2 h-4 w-4" />
            <span>Color Theme</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {Object.entries(colorThemes).map(([key]) => {
              const isSelected = key === colorTheme

              return (
                <DropdownMenuItem
                  key={key}
                  onClick={() => setColorTheme(key as ColorTheme)}
                  role="menuitemradio"
                  aria-checked={isSelected}
                  className={`flex items-center justify-between gap-2 cursor-pointer ${
                    isSelected ? 'font-medium text-foreground' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="capitalize">{key}</span>
                  </div>
                  {isSelected && <Check className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CaseSensitive className="mr-2 h-4 w-4" />
            <span>Font</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              onClick={() => setFont('system')}
              role="menuitemradio"
              aria-checked={font === 'system'}
              className={`flex items-center justify-between gap-2 cursor-pointer ${
                font === 'system' ? 'font-medium text-foreground' : ''
              }`}
            >
              <span>System</span>
              {font === 'system' && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setFont('maple')}
              role="menuitemradio"
              aria-checked={font === 'maple'}
              className={`flex items-center justify-between gap-2 cursor-pointer ${
                font === 'maple' ? 'font-medium text-foreground' : ''
              }`}
            >
              <span>Maple</span>
              {font === 'maple' && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setFont('jetbrains')}
              role="menuitemradio"
              aria-checked={font === 'jetbrains'}
              className={`flex items-center justify-between gap-2 cursor-pointer ${
                font === 'jetbrains' ? 'font-medium text-foreground' : ''
              }`}
            >
              <span>JetBrains Mono</span>
              {font === 'jetbrains' && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ZoomIn className="mr-2 h-4 w-4" />
            <span>Display Scale</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 p-3">
            <div
              className="flex items-center gap-2"
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Button
                aria-label="Decrease display scale"
                className="size-8"
                disabled={displayScale <= DISPLAY_SCALE_MIN}
                size="icon"
                type="button"
                variant="outline"
                onClick={() =>
                  handleDisplayScaleChange(displayScale - DISPLAY_SCALE_STEP)
                }
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                aria-label="Display scale percent"
                className="h-8 text-center tabular-nums"
                type="number"
                min={DISPLAY_SCALE_MIN}
                max={DISPLAY_SCALE_MAX}
                step={DISPLAY_SCALE_STEP}
                value={scaleInput}
                onBlur={commitScaleInput}
                onChange={(event) => setScaleInput(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') {
                    commitScaleInput()
                    event.currentTarget.blur()
                  }
                }}
              />
              <Button
                aria-label="Increase display scale"
                className="size-8"
                disabled={displayScale >= DISPLAY_SCALE_MAX}
                size="icon"
                type="button"
                variant="outline"
                onClick={() =>
                  handleDisplayScaleChange(displayScale + DISPLAY_SCALE_STEP)
                }
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {(user.isAdmin() || !hasGlobalSidebarPreference) && (
          <SidebarCustomizer onOpenChange={(d) => setOpen(d)} />
        )}

        {user.provider !== 'Anonymous' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="cursor-pointer text-red-600 focus:text-red-600"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
