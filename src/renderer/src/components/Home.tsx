import { useState } from 'react'
import { SessionForm } from './SessionForm'
import { SessionList } from './SessionList'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

export function Home(): JSX.Element {
  const [tab, setTab] = useState<'create' | 'past'>('create')

  return (
    <div className="flex flex-col h-full px-3 pt-3">
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'create' | 'past')} className="flex flex-col h-full min-h-0">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="create">Create</TabsTrigger>
          <TabsTrigger value="past">Past Sessions</TabsTrigger>
        </TabsList>
        <TabsContent value="create" className="flex-1 min-h-0 mt-3 overflow-y-auto">
          <SessionForm />
        </TabsContent>
        <TabsContent value="past" className="flex-1 min-h-0 mt-3 overflow-y-auto">
          <SessionList />
        </TabsContent>
      </Tabs>
    </div>
  )
}
