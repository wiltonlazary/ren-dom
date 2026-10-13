// A worker_threads worker for test/remote.test.jsx: a counter served over
// parentPort. Plain JS (the JSX loader does not run in worker threads).
import { parentPort } from 'node:worker_threads';
import { $root, $signal, $read, $write } from 'rrx-core';
import { serve } from 'ren-core/worker';
import { jsx } from 'ren-core/jsx-runtime';

const root = $root('app');
const count = $signal(root, 0);
serve(
  () =>
    jsx('div', {
      children: [
        jsx('button', { onClick: () => $write(count, $read(count) + 1), children: 'add' }),
        jsx('b', { children: count }),
      ],
    }),
  {
    port: /** @type {any} */ (parentPort),
    root,
    message: data => {
      if (data === 'bump') $write(count, $read(count) + 10);
    },
  },
);
