// The server's real config plus the timings its tests already may shorten (ServerConfig.updateWaitMs and the like)
import { loadConfig as real, gitRootOf } from '../../apps/server/src/config.ts'

export { gitRootOf }
export const loadConfig = () => ({ ...real(), ...JSON.parse(process.env.E2E_CONFIG ?? '{}') })
