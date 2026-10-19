'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../scripts/inject.js'), 'utf8');

function harness() {
  const attributes = new Map();
  const documentElement = {
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); },
  };
  const parents = [];
  function mountNavigation() {
    const parent = {
      children: [],
      removeChild(node) {
        const index = this.children.indexOf(node);
        if (index < 0) throw new DOMException('The node to be removed is not a child of this node.', 'NotFoundError');
        this.children.splice(index, 1);
        node.parentNode = null;
      },
    };
    const aside = {
      parentNode: parent,
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    };
    parent.children.push(aside);
    parents.push(parent);
    return { parent, aside };
  }
  const document = {
    documentElement,
    querySelectorAll(selector) {
      assert.equal(selector, 'aside.conversation-history-navigation');
      return parents.flatMap(parent => parent.children);
    },
  };
  const name = 'setOfficialConversationHistoryNavigationHidden';
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('\n    // 会话消息导航：', start);
  assert.ok(start >= 0 && end > start, 'official navigation visibility helper missing');
  const context = { document };
  vm.runInNewContext(source.slice(start, end), context);
  return { setHidden: context[name], mountNavigation, documentElement };
}

test('switching between two tasks leaves official navigation nodes available for React to unmount', () => {
  const { setHidden, mountNavigation } = harness();
  let tasks = [mountNavigation(), mountNavigation()];
  for (let i = 0; i < 100; i++) {
    setHidden(true);
    const index = i % tasks.length;
    const { parent, aside } = tasks[index];
    assert.doesNotThrow(() => parent.removeChild(aside), 'official unmount must not throw NotFoundError');
    assert.equal(parent.children.length, 0);
    tasks[index] = mountNavigation();
  }
});

test('message index visibility is reversible and also covers navigation mounted after enabling', () => {
  const { setHidden, mountNavigation, documentElement } = harness();
  const first = mountNavigation();
  setHidden(true);
  const second = mountNavigation();
  assert.equal(first.aside.parentNode, first.parent);
  assert.equal(second.aside.parentNode, second.parent);
  assert.equal(documentElement.hasAttribute('data-wbs-message-nav'), true);
  setHidden(false);
  assert.equal(documentElement.hasAttribute('data-wbs-message-nav'), false);
  assert.deepEqual(first.parent.children, [first.aside]);
  assert.deepEqual(second.parent.children, [second.aside]);
});

test('official navigation uses theme-independent CSS hiding and restores on disable or disposal', () => {
  assert.match(source, /html\[data-wbs-message-nav\] aside\.conversation-history-navigation\{display:none!important\}/);
  const start = source.indexOf('    function createMessageNavigation(');
  const end = source.indexOf('    var messageNavigation = createMessageNavigation();', start);
  const navigation = source.slice(start, end);
  assert.match(navigation, /function setEnabled\(enabled\)\s*\{\s*setOfficialConversationHistoryNavigationHidden\(enabled\)/);
  assert.match(navigation, /setOfficialConversationHistoryNavigationHidden\(sessState\.messageNav\)/);
  assert.match(navigation, /registerDisposer\(function \(\)\s*\{\s*setOfficialConversationHistoryNavigationHidden\(false\)/);
  assert.doesNotMatch(source, /removeOfficialConversationHistoryNavigation/);
});
