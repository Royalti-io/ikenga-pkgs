// Dev-only ambient declarations so `tsc -p tsconfig.dev.json --checkJs` can
// resolve the https://esm.sh/* import URLs (TypeScript cannot fetch them).
// NEVER referenced by the publish path — the browser resolves these natively.

declare module 'https://esm.sh/react@19.0.0' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const React: any;
  export = React;
}
declare module 'https://esm.sh/react-dom@19.0.0/client' {
  export const createRoot: (el: Element | null) => { render: (node: unknown) => void };
}
declare module 'https://esm.sh/htm@3.1.1' {
  const htm: { bind: (h: unknown) => (...args: unknown[]) => unknown };
  export default htm;
}
declare module 'https://esm.sh/@tanstack/react-query@5?deps=react@19.0.0' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const QueryClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const QueryClientProvider: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const useQuery: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const useMutation: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const useQueryClient: any;
}
declare module 'https://esm.sh/@supabase/supabase-js@2' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const createClient: any;
}
declare module 'https://esm.sh/@modelcontextprotocol/ext-apps@1.7.1/app-with-deps' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const App: any;
  export const applyDocumentTheme: (theme: unknown) => void;
  export const applyHostStyleVariables: (vars: unknown) => void;
  export const applyHostFonts: (fonts: unknown) => void;
}
