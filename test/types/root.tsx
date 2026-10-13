// Application roots and contexts, as a TypeScript consumer sees them: one
// module (ren-core) re-exports rrx-core, so Root, contexts and signals share it.
import {
  Root, $signal, $read, $write, $flush, $dispose, $context, $provide, $lookup, $update, $entries,
  Id, Storage, Locks, Runtime, Props, Send, $name, $roots, View, Label, Action,
} from 'ren-core';
import type { Graph, Shelf, Locker } from 'ren-core';
import { $dom, $shadow } from 'ren-dom';

const Theme = $context('light');
const theme: string = $lookup(Theme);
// @ts-expect-error a string context holds strings
const wrong: number = $lookup(Theme);
$update(Theme, 'dark');
$update(Theme, previous => `${previous}!`);
// @ts-expect-error a string context refuses a number
$update(Theme, 3);

const plain: Graph = Root('state');
const count = $signal(plain, 1);
$provide(plain, Theme, () => 'accessor', () => $lookup(Theme).length);
const entries: [unknown, unknown][] = $entries(plain);
const rooted: string = $lookup(plain, Theme);
$update(plain, Theme, 'dark');
$update(plain, Theme, previous => previous.toUpperCase());
// @ts-expect-error a string context refuses a number, root-first too
$update(plain, Theme, 3);
const named: string = $name(plain, 'title');
void [rooted, named];

declare const page: HTMLElement;
declare const document: Document;
const App = () => {
  const id: string = $lookup(Id);
  const shelf: Shelf | null = $lookup(Storage);
  const locks: Locker = $lookup(Locks);
  const where: 'direct' | 'worker' = $lookup(Runtime).runtime;
  void [id, shelf?.get('k'), locks.request('save', () => 1), where, $lookup(Props)];
  return (
    <View>
      <Label text={() => `${$read(count)} ${$name('title')}`} />
      <Action text="send" onPress={() => $lookup(Send)({ n: 1 })} />
      <Theme value="dark">
        <Root id="side" renderer={$shadow({ mode: 'closed', theme: { accent: 0xff000000 } })} props={() => $read(count)} onMessage={data => void data}>
          {() => <Label text="nested" />}
        </Root>
      </Theme>
    </View>
  );
};

const app: Graph = Root({ id: 'main', target: page, renderer: $dom(document, { theme: { ink: 0xff111111 }, styles: 'p { margin: 0 }' }), children: <App /> });
$write(count, 2);
$flush(app);
const live: string[] = $roots(document);
// @ts-expect-error Root options need an id
Root({ target: page, renderer: $dom(page.ownerDocument) });
$dispose(app);
void [theme, wrong, entries, live];
