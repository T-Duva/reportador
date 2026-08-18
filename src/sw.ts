/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> }

self.skipWaiting()
clientsClaim()
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
