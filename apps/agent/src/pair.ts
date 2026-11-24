import WebSocket from 'ws'
import { PROTOCOL_VERSION, ServerMessage, decode } from '@tgcv/protocol'
import { deviceOs } from './config.ts'

// One round trip with the server: a code from /pair in, this computer's id and key out
export function pairDevice(serverUrl: string, code: string, deviceName: string): Promise<{ deviceId: string, key: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(serverUrl)
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error(`Server ${serverUrl} did not answer within 15 s`))
    }, 15_000)
    ws.on('open', () => ws.send(JSON.stringify({ type: 'pair', protocol: PROTOCOL_VERSION, code, deviceName, os: deviceOs() })))
    ws.on('message', raw => {
      clearTimeout(timer)
      const m = decode(ServerMessage, raw)
      ws.close()
      if (m?.type === 'paired') resolve({ deviceId: m.deviceId, key: m.key })
      else reject(new Error(m?.type === 'reject' ? m.reason : 'Unrecognized answer from the server'))
    })
    ws.on('error', e => {
      clearTimeout(timer)
      reject(new Error(`Cannot connect to ${serverUrl}: ${e.message}`))
    })
  })
}
