import { Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './dropdown-menu'
import { cn } from '../../lib/utils'

export interface SelectOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  align?: 'start' | 'center' | 'end'
  disabled?: boolean
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className,
  align = 'start',
  disabled
}: SelectProps): JSX.Element {
  const current = options.find((o) => o.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'input flex items-center justify-between gap-2 cursor-pointer text-left',
            !current && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">{current?.label ?? placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={4}
        className="max-h-[280px] overflow-y-auto"
        style={{ minWidth: 'var(--radix-dropdown-menu-trigger-width)' }}
      >
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No options</div>
        )}
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            disabled={opt.disabled}
            onSelect={() => onChange(opt.value)}
          >
            <Check
              className={cn(
                'h-3.5 w-3.5 mt-0.5 shrink-0',
                opt.value === value ? 'text-brand-400' : 'opacity-0'
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{opt.label}</div>
              {opt.hint && (
                <div className="text-[11px] text-muted-foreground truncate">{opt.hint}</div>
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
