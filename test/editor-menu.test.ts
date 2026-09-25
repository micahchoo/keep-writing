import { describe, expect, test } from 'bun:test';
import { addMenuActions } from '../src/main';
import type { MenuAction } from '../src/main';

// The right-click submenu. `MenuItem.setSubmenu` is undocumented: present in
// the app, absent from the typings. Called where it is missing, it throws
// inside an `editor-menu` handler and takes out the WHOLE context menu, so the
// layout is decided by testing for it, and a phone gets the flat layout even
// where it exists, because a nested menu wants a hover a touch screen lacks.

interface Item {
  title?: string;
  section?: string;
  sub?: FakeMenu;
  clicked?: () => void;
}

class FakeMenu {
  items: Item[] = [];
  constructor(private nests: boolean) {}
  addItem(build: (item: object) => void): this {
    const item: Item = {};
    const api: Record<string, unknown> = {
      setTitle: (t: string) => { item.title = t; return api; },
      setIcon: () => api,
      setSection: (s: string) => { item.section = s; return api; },
      onClick: (f: () => void) => { item.clicked = f; return api; },
    };
    if (this.nests) api['setSubmenu'] = () => (item.sub = new FakeMenu(true));
    build(api);
    this.items.push(item);
    return this;
  }
}

const ran: string[] = [];
const ACTIONS: MenuAction[] = [
  { title: 'Draw a question', icon: 'shuffle', run: () => ran.push('draw') },
  { title: 'Mark this answer done, and follow up', icon: 'check', run: () => ran.push('mark') },
];

describe('the editor menu', () => {
  test('on a desktop that has submenus: one keep-writing item, the actions under it', () => {
    const menu = new FakeMenu(true);
    addMenuActions(menu as never, ACTIONS, false);
    expect(menu.items.map((i) => i.title)).toEqual(['keep-writing']);
    expect(menu.items[0]!.sub!.items.map((i) => i.title)).toEqual(ACTIONS.map((a) => a.title));
  });

  test('where setSubmenu is missing: every action flat, in its own section, and nothing throws', () => {
    const menu = new FakeMenu(false);
    addMenuActions(menu as never, ACTIONS, false);
    expect(menu.items.map((i) => [i.title, i.section])).toEqual(ACTIONS.map((a) => [a.title, 'keep-writing']));
  });

  test('on a phone: flat, even where submenus exist', () => {
    const menu = new FakeMenu(true);
    addMenuActions(menu as never, ACTIONS, true);
    expect(menu.items.map((i) => i.title)).toEqual(ACTIONS.map((a) => a.title));
    expect(menu.items.every((i) => !i.sub)).toBe(true);
  });

  test('an item runs its action', () => {
    ran.length = 0;
    const menu = new FakeMenu(false);
    addMenuActions(menu as never, ACTIONS, false);
    menu.items[1]!.clicked!();
    expect(ran).toEqual(['mark']);
  });
});
