// `node --test --import=tsx --import=./ui/src/test/register.mjs …`
//
// tsx is registered first (it compiles the TypeScript); this then registers
// the CSS hooks on top, so they get first refusal on every specifier and hand
// everything that is not a stylesheet back down the chain.
import { register } from 'node:module';

register('./css-hooks.mjs', import.meta.url);
