import { useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { CaseSensitive, Check, LogOut, Palette } from 'lucide-react'

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
import { useAppearance } from '@/components/appearance-provider'
import { ColorTheme, colorThemes } from '@/components/color-theme-provider'

import { SidebarCustomizer } from './sidebar-customizer'

export function UserMenu() {
  const { user, logout, hasGlobalSidebarPreference } = useAuth()
  const { colorTheme, setColorTheme, font, setFont } = useAppearance()
  const [open, setOpen] = useState(false)

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
