// One build serves any address: the page origin is the API origin unless VITE_API_URL says otherwise.
export const apiBase = () =>
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:8787' : window.location.origin)
