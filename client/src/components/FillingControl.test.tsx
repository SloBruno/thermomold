// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FillingControl from './FillingControl'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('default manual; deliberate enable carries current revision; stop remains available', async () => {
  const control={mode:'manual',session:'s1',revision:3,deviceSession:'b1'}
  const fetcher=vi.fn(async (_url: string, init?: RequestInit) => ({ok:true,json:async()=> init ? {...control,mode:JSON.parse(init.body as string).mode,revision:4}: control}))
  vi.stubGlobal('fetch',fetcher)
  render(<FillingControl />)
  await waitFor(()=>expect((screen.getByRole('button',{name:'Automático'}) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button',{name:'Automático'}))
  await screen.findByText(/Solicitado: Automático/)
  expect(JSON.parse(fetcher.mock.calls.find(c=>c[1]?.method==='POST')![1]!.body as string)).toEqual({mode:'automatic',session:'s1',revision:3})
  fireEvent.click(screen.getByRole('button',{name:'Manual / Parar tudo'}))
  await screen.findByText(/Solicitado: Manual/)
})
test('failed enable is visible and never displayed as applied', async () => {
  vi.stubGlobal('fetch',vi.fn(async (_url:string,init?:RequestInit)=>({ok:!init,json:async()=>({mode:'manual',session:'s',revision:1,deviceSession:'b'})})))
  render(<FillingControl />)
  await waitFor(()=>expect((screen.getByRole('button',{name:'Automático'}) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button',{name:'Automático'}))
  await screen.findByRole('alert')
  expect(screen.queryByText(/Solicitado: Automático/)).toBeNull()
})
