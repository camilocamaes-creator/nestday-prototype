/*
 * Nestday prototype runtime
 * -------------------------
 * A tiny interpreter for the screen files in /screens-source (the .dc.html
 * format exported from the Claude design canvas). Each screen is:
 *   - a template: plain HTML with {{holes}}, <sc-for>, <sc-if>, <dc-import>
 *   - a logic class: `class Component extends DCLogic { renderVals() { ... } }`
 * This file turns the template into React elements and wires up state.
 * It only exists so the prototype runs anywhere. The real product should be
 * rebuilt properly (see README.md).
 */
(function () {
  'use strict';
  var h = React.createElement;

  class DCLogic extends React.Component {
    constructor(props) { super(props); this.state = {}; }
  }
  window.DCLogic = DCLogic;

  var registry = {};

  // ---------- value lookup ----------
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var ANY = /\{\{\s*([^}]+?)\s*\}\}/g;

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.');
    var v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function resolve(raw, scope) {
    if (raw == null) return raw;
    var m = raw.match(WHOLE);
    if (m) return lookup(m[1], scope);
    if (raw.indexOf('{{') < 0) return raw;
    return raw.replace(ANY, function (_, p) { var v = lookup(p, scope); return v == null ? '' : String(v); });
  }

  // ---------- attribute mapping ----------
  var EVENTS = {
    onclick: 'onClick', onchange: 'onChange', onsubmit: 'onSubmit', oninput: 'onInput',
    onkeydown: 'onKeyDown', onkeyup: 'onKeyUp', onfocus: 'onFocus', onblur: 'onBlur',
    onmouseenter: 'onMouseEnter', onmouseleave: 'onMouseLeave', onpointerdown: 'onPointerDown'
  };
  var RENAME = {
    'class': 'className', 'for': 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly',
    maxlength: 'maxLength', autocomplete: 'autoComplete', autofocus: 'autoFocus',
    colspan: 'colSpan', rowspan: 'rowSpan', crossorigin: 'crossOrigin', enterkeyhint: 'enterKeyHint',
    inputmode: 'inputMode', 'xlink:href': 'xlinkHref'
  };
  var BOOL = { multiple: 1, disabled: 1, checked: 1, readonly: 1, required: 1, selected: 1, autofocus: 1, open: 1, hidden: 1 };

  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }
  function styleObj(str) {
    var out = {};
    if (!str) return out;
    String(str).split(';').forEach(function (decl) {
      var i = decl.indexOf(':');
      if (i < 0) return;
      var k = decl.slice(0, i).trim();
      var v = decl.slice(i + 1).trim();
      if (!k) return;
      out[k.indexOf('--') === 0 ? k : camel(k)] = v;
    });
    return out;
  }

  function propsFor(el, scope, key) {
    var p = { key: key };
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      var name = a.name;
      var val = resolve(a.value, scope);
      var lname = name.toLowerCase();
      if (EVENTS[lname]) { if (typeof val === 'function') p[EVENTS[lname]] = val; continue; }
      if (lname === 'style') { p.style = styleObj(val); continue; }
      if (BOOL[lname] && a.value === '') val = true;
      if (lname === 'value' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
        p.value = val == null ? '' : val;
        continue;
      }
      if (lname === 'checked') { p.checked = !!val; continue; }
      if (RENAME[lname]) { p[RENAME[lname]] = val; continue; }
      if (lname.indexOf('aria-') === 0 || lname.indexOf('data-') === 0) {
        p[lname] = typeof val === 'boolean' ? String(val) : val;
        continue;
      }
      if (name.indexOf('-') > 0) { p[camel(name)] = val; continue; }
      p[name] = val;
    }
    // controlled inputs with no handler would be read-only; keep them editable
    if ('value' in p && !p.onChange && el.tagName !== 'SELECT') { p.defaultValue = p.value; delete p.value; }
    if ('checked' in p && !p.onChange) { p.defaultChecked = p.checked; delete p.checked; }
    return p;
  }

  // ---------- rendering ----------
  // build.py renames table tags to dc-* so loops inside tables survive parsing
  var TABLE_TAG = {};
  ['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col'].forEach(function (t) { TABLE_TAG['dc-' + t] = t; });

  function renderNodes(nodes, scope, keyBase) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var r = renderNode(nodes[i], scope, keyBase + '.' + i);
      if (r === null || r === undefined) continue;
      if (Array.isArray(r)) out.push.apply(out, r); else out.push(r);
    }
    return out;
  }

  function renderNode(node, scope, key) {
    if (node.nodeType === 3) {
      var text = node.nodeValue;
      if (!text.trim() && text.indexOf('\n') >= 0) return null;
      return resolve(text, scope);
    }
    if (node.nodeType !== 1) return null;
    var tag = node.tagName.toLowerCase();
    if (TABLE_TAG[tag]) tag = TABLE_TAG[tag];

    if (tag === 'helmet') return null;
    if (tag === 'sc-if') {
      return lookup((node.getAttribute('value') || '').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope)
        ? h(React.Fragment, { key: key }, renderNodes(node.childNodes, scope, key)) : null;
    }
    if (tag === 'sc-for') {
      var list = resolve(node.getAttribute('list'), scope) || [];
      var as = node.getAttribute('as') || 'item';
      return h(React.Fragment, { key: key }, list.map(function (item, i) {
        var s = Object.create(scope);
        s[as] = item;
        s.$index = i;
        return h(React.Fragment, { key: i }, renderNodes(node.childNodes, s, key + '.' + i));
      }));
    }
    if (tag === 'dc-import') {
      var name = node.getAttribute('name');
      var Comp = registry[name];
      if (!Comp) return h('div', { key: key }, 'Missing screen: ' + name);
      var props = { key: key };
      for (var j = 0; j < node.attributes.length; j++) {
        var at = node.attributes[j];
        if (at.name === 'name' || at.name.indexOf('hint-') === 0) continue;
        props[camel(at.name)] = resolve(at.value, scope);
      }
      return h(Comp, props);
    }
    var children = (tag === 'textarea') ? [] : renderNodes(node.childNodes, scope, key);
    var p = propsFor(node, scope, key);
    return h(tag, p, children.length ? children : undefined);
  }

  // ---------- registration ----------
  function register(name) {
    var tplEl = document.querySelector('template[data-dc-template="' + name + '"]');
    var scriptEl = document.querySelector('script[data-dc-name="' + name + '"]');
    if (!tplEl || !scriptEl) throw new Error('Screen not found: ' + name);
    var root = tplEl.content.querySelector('x-dc') || tplEl.content;

    // move <helmet> fonts and styles into <head> once
    var helmet = root.querySelector('helmet');
    if (helmet) {
      Array.prototype.forEach.call(helmet.children, function (c) {
        var sig = c.outerHTML;
        if (!document.head.querySelector('[data-helmet="' + btoa(unescape(encodeURIComponent(sig))).slice(0, 40) + '"]')) {
          var copy = c.cloneNode(true);
          copy.setAttribute('data-helmet', btoa(unescape(encodeURIComponent(sig))).slice(0, 40));
          document.head.appendChild(copy);
        }
      });
    }

    var Logic = new Function('DCLogic', scriptEl.textContent + '\nreturn Component;')(DCLogic);
    var nodes = Array.prototype.filter.call(root.childNodes, function (n) {
      return !(n.nodeType === 1 && n.tagName.toLowerCase() === 'helmet');
    });
    class Screen extends Logic {
      render() {
        var vals = this.renderVals ? this.renderVals() : {};
        var out = renderNodes(nodes, vals || {}, 'r');
        return out.length === 1 ? out[0] : h(React.Fragment, null, out);
      }
    }
    Screen.displayName = name;
    registry[name] = Screen;
    return Screen;
  }

  function mount(name, extraProps) {
    document.querySelectorAll('template[data-dc-template]').forEach(function (t) {
      var n = t.getAttribute('data-dc-template');
      if (!registry[n] && n !== name) register(n);
    });
    var Screen = registry[name] || register(name);
    // screen props can come from the URL, e.g. Upload.dc.html?linkState=expired
    var props = Object.assign({}, extraProps || {});
    new URLSearchParams(location.search).forEach(function (v, k) { props[k] = v; });
    ReactDOM.createRoot(document.getElementById('app')).render(h(Screen, props));
  }

  window.NestdayDC = { mount: mount, register: register };
})();
