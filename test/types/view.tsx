// JSX with jsxImportSource "ren-core": ren-core primitives, HTML tags and components.
import { $root, $signal, $read, $write } from 'rrx-core';
import { Show, For, View, Label, Action, Edit } from 'ren-core';
import { render } from 'ren-dom';

const root = $root('app');
const count = $signal(root, 0);
const items = $signal(root, [{ id: 1, title: 'a' }]);

function Row(props: { title: () => string }) {
  return <li class="row">{props.title}</li>;
}

const app = () => (
  <View gap={8} pad={() => $read(count)}>
    <Label text={() => `count ${$read(count)}`} size={13} />
    <Action text="Add" onPress={() => $write(count, $read(count) + 1)} />
    <Edit value={() => String($read(count))} onChange={event => $write(count, Number(event.value))} />
    <Show when={() => $read(count) > 0} fallback={<i>none</i>}>
      <ul>
        <For each={items} by={item => item.id}>{item => <Row title={() => item().title} />}</For>
      </ul>
    </Show>
    <Action text="Styled" style={{ padding: [4, 8], background: '#336699', radius: 6, hover: { background: 0xff224466 }, shadow: { y: 1, blur: 3 } }} />
    <Label text="row" style={() => ({ direction: 'row', align: 'center', fontWeight: 'bold' })} />
    {/* @ts-expect-error direction is 'row' or 'column' */}
    <View style={{ direction: 'diagonal' }} />
    {/* @ts-expect-error Label text must be text or a number */}
    <Label text={{ wrong: true }} />
  </View>
);

declare const container: Element;
const dispose: () => void = render(app, container, { root });
dispose();
