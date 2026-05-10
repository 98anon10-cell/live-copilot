import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface Props {
  children: ReactNode
  tooltip: ReactNode
  htmlFor?: string
}

export function LabelWithTooltip({ children, tooltip, htmlFor }: Props): JSX.Element {
  return (
    <div className="flex items-center gap-1 text-sm font-medium">
      <label htmlFor={htmlFor} className="flex items-center gap-1">
        {children}
      </label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-muted-foreground hover:text-foreground" tabIndex={-1}>
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px] leading-relaxed">{tooltip}</TooltipContent>
      </Tooltip>
    </div>
  )
}
