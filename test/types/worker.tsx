// The worker mode's entries, as a TypeScript consumer sees them.
import { $root, $signal, $read, $write, $defer } from 'rrx-core';
import { View, Label, Edit } from 'ren-core';
import { serve, Input, Handle, type Lane, type Session } from 'ren-core/worker';
import { connect, Connection, Applied } from 'ren-core/remote';
import { $dom } from 'ren-dom';

const root = $root('app');
const text = $signal(root, '');
declare const port: MessagePort;

const session: Session = serve(
  () => (
    <View prevent="submit">
      <Edit value={text} onChange={event => $write(text, event.value)} />
      <Label text={() => $read(text).length} />
    </View>
  ),
  {
    port,
    root,
    budget: 8,
    lanes: true,
    coalesce: true,
    backpressure: true,
    message: (data: unknown, lane: Lane) => {
      if (lane === 'background') $defer(root, () => $write(text, String(data)));
    },
  },
);
session.post({ ready: true });
const events: number = session.counters.events;
session.dispose();

declare const worker: Worker;
declare const container: HTMLElement;
const connection: Connection = connect(worker, $dom(document), container, {
  schedule: 'frame',
  applied: (info: Applied) => {
    const ms: number = info.ms + info.present;
    const urgent: boolean = info.urgent;
  },
  message: (data: unknown) => {},
});
const seq: number = connection.post('load', 'background');
const idle: Promise<void> = connection.idle();
const busy: number = connection.totals.busy;
connection.close();

// @ts-expect-error a lane is urgent, normal or background
connection.post('x', 'soon');

declare const input: Input;
const value: string | null = input.value;
const shift: boolean = input.shiftKey;
declare const handle: Handle;
const id: number = handle.id;
