(function () {
  const t = document.createElement('link').relList;
  if (t && t.supports && t.supports('modulepreload')) return;
  for (const a of document.querySelectorAll('link[rel="modulepreload"]')) n(a);
  new MutationObserver((a) => {
    for (const i of a)
      if (i.type === 'childList')
        for (const o of i.addedNodes) o.tagName === 'LINK' && o.rel === 'modulepreload' && n(o);
  }).observe(document, { childList: !0, subtree: !0 });
  function e(a) {
    const i = {};
    return (
      a.integrity && (i.integrity = a.integrity),
      a.referrerPolicy && (i.referrerPolicy = a.referrerPolicy),
      a.crossOrigin === 'use-credentials'
        ? (i.credentials = 'include')
        : a.crossOrigin === 'anonymous'
        ? (i.credentials = 'omit')
        : (i.credentials = 'same-origin'),
      i
    );
  }
  function n(a) {
    if (a.ep) return;
    a.ep = !0;
    const i = e(a);
    fetch(a.href, i);
  }
})();
var Iu =
    typeof globalThis < 'u'
      ? globalThis
      : typeof window < 'u'
      ? window
      : typeof global < 'u'
      ? global
      : typeof self < 'u'
      ? self
      : {},
  Cu = {},
  _a,
  Ou;
function Re() {
  if (Ou) return _a;
  Ou = 1;
  var r = function (t) {
    return t && t.Math == Math && t;
  };
  return (
    (_a =
      r(typeof globalThis == 'object' && globalThis) ||
      r(typeof window == 'object' && window) ||
      r(typeof self == 'object' && self) ||
      r(typeof Iu == 'object' && Iu) ||
      Function('return this')()),
    _a
  );
}
var wa = {},
  Sa,
  Nu;
function Ee() {
  return (
    Nu ||
      ((Nu = 1),
      (Sa = function (r) {
        try {
          return !!r();
        } catch {
          return !0;
        }
      })),
    Sa
  );
}
var ka, Mu;
function Ye() {
  if (Mu) return ka;
  Mu = 1;
  var r = Ee();
  return (
    (ka = !r(function () {
      return (
        Object.defineProperty({}, 1, {
          get: function () {
            return 7;
          },
        })[1] != 7
      );
    })),
    ka
  );
}
var Ea = {},
  Fu;
function aa() {
  if (Fu) return Ea;
  Fu = 1;
  var r = {}.propertyIsEnumerable,
    t = Object.getOwnPropertyDescriptor,
    e = t && !r.call({ 1: 2 }, 1);
  return (
    (Ea.f = e
      ? function (a) {
          var i = t(this, a);
          return !!i && i.enumerable;
        }
      : r),
    Ea
  );
}
var Aa, qu;
function Rt() {
  return (
    qu ||
      ((qu = 1),
      (Aa = function (r, t) {
        return { enumerable: !(r & 1), configurable: !(r & 2), writable: !(r & 4), value: t };
      })),
    Aa
  );
}
var Ra, Bu;
function Gr() {
  if (Bu) return Ra;
  Bu = 1;
  var r = {}.toString;
  return (
    (Ra = function (t) {
      return r.call(t).slice(8, -1);
    }),
    Ra
  );
}
var Ta, Du;
function gn() {
  if (Du) return Ta;
  Du = 1;
  var r = Ee(),
    t = Gr(),
    e = ''.split;
  return (
    (Ta = r(function () {
      return !Object('z').propertyIsEnumerable(0);
    })
      ? function (n) {
          return t(n) == 'String' ? e.call(n, '') : Object(n);
        }
      : Object),
    Ta
  );
}
var xa, ju;
function ht() {
  return (
    ju ||
      ((ju = 1),
      (xa = function (r) {
        if (r == null) throw TypeError("Can't call method on " + r);
        return r;
      })),
    xa
  );
}
var Pa, Lu;
function Or() {
  if (Lu) return Pa;
  Lu = 1;
  var r = gn(),
    t = ht();
  return (
    (Pa = function (e) {
      return r(t(e));
    }),
    Pa
  );
}
var Ia, Uu;
function Je() {
  return (
    Uu ||
      ((Uu = 1),
      (Ia = function (r) {
        return typeof r == 'object' ? r !== null : typeof r == 'function';
      })),
    Ia
  );
}
var Ca, zu;
function Tt() {
  if (zu) return Ca;
  zu = 1;
  var r = Je();
  return (
    (Ca = function (t, e) {
      if (!r(t)) return t;
      var n, a;
      if (
        (e && typeof (n = t.toString) == 'function' && !r((a = n.call(t)))) ||
        (typeof (n = t.valueOf) == 'function' && !r((a = n.call(t)))) ||
        (!e && typeof (n = t.toString) == 'function' && !r((a = n.call(t))))
      )
        return a;
      throw TypeError("Can't convert object to primitive value");
    }),
    Ca
  );
}
var Oa, Wu;
function ar() {
  if (Wu) return Oa;
  Wu = 1;
  var r = {}.hasOwnProperty;
  return (
    (Oa = function (t, e) {
      return r.call(t, e);
    }),
    Oa
  );
}
var Na, Hu;
function Ws() {
  if (Hu) return Na;
  Hu = 1;
  var r = Re(),
    t = Je(),
    e = r.document,
    n = t(e) && t(e.createElement);
  return (
    (Na = function (a) {
      return n ? e.createElement(a) : {};
    }),
    Na
  );
}
var Ma, Gu;
function zv() {
  if (Gu) return Ma;
  Gu = 1;
  var r = Ye(),
    t = Ee(),
    e = Ws();
  return (
    (Ma =
      !r &&
      !t(function () {
        return (
          Object.defineProperty(e('div'), 'a', {
            get: function () {
              return 7;
            },
          }).a != 7
        );
      })),
    Ma
  );
}
var Vu;
function Yr() {
  if (Vu) return wa;
  Vu = 1;
  var r = Ye(),
    t = aa(),
    e = Rt(),
    n = Or(),
    a = Tt(),
    i = ar(),
    o = zv(),
    s = Object.getOwnPropertyDescriptor;
  return (
    (wa.f = r
      ? s
      : function (l, c) {
          if (((l = n(l)), (c = a(c, !0)), o))
            try {
              return s(l, c);
            } catch {}
          if (i(l, c)) return e(!t.f.call(l, c), l[c]);
        }),
    wa
  );
}
var Fa = {},
  qa,
  $u;
function sr() {
  if ($u) return qa;
  $u = 1;
  var r = Je();
  return (
    (qa = function (t) {
      if (!r(t)) throw TypeError(String(t) + ' is not an object');
      return t;
    }),
    qa
  );
}
var Ku;
function ur() {
  if (Ku) return Fa;
  Ku = 1;
  var r = Ye(),
    t = zv(),
    e = sr(),
    n = Tt(),
    a = Object.defineProperty;
  return (
    (Fa.f = r
      ? a
      : function (o, s, u) {
          if ((e(o), (s = n(s, !0)), e(u), t))
            try {
              return a(o, s, u);
            } catch {}
          if ('get' in u || 'set' in u) throw TypeError('Accessors not supported');
          return 'value' in u && (o[s] = u.value), o;
        }),
    Fa
  );
}
var Ba, Zu;
function gr() {
  if (Zu) return Ba;
  Zu = 1;
  var r = Ye(),
    t = ur(),
    e = Rt();
  return (
    (Ba = r
      ? function (n, a, i) {
          return t.f(n, a, e(1, i));
        }
      : function (n, a, i) {
          return (n[a] = i), n;
        }),
    Ba
  );
}
var Da = { exports: {} },
  ja,
  Xu;
function Hs() {
  if (Xu) return ja;
  Xu = 1;
  var r = Re(),
    t = gr();
  return (
    (ja = function (e, n) {
      try {
        t(r, e, n);
      } catch {
        r[e] = n;
      }
      return n;
    }),
    ja
  );
}
var La, Yu;
function Wv() {
  if (Yu) return La;
  Yu = 1;
  var r = Re(),
    t = Hs(),
    e = '__core-js_shared__',
    n = r[e] || t(e, {});
  return (La = n), La;
}
var Ua, Ju;
function Gs() {
  if (Ju) return Ua;
  Ju = 1;
  var r = Wv(),
    t = Function.toString;
  return (
    typeof r.inspectSource != 'function' &&
      (r.inspectSource = function (e) {
        return t.call(e);
      }),
    (Ua = r.inspectSource),
    Ua
  );
}
var za, Qu;
function $y() {
  if (Qu) return za;
  Qu = 1;
  var r = Re(),
    t = Gs(),
    e = r.WeakMap;
  return (za = typeof e == 'function' && /native code/.test(t(e))), za;
}
var Wa = { exports: {} },
  Ha,
  el;
function dt() {
  return el || ((el = 1), (Ha = !1)), Ha;
}
var rl;
function Vs() {
  if (rl) return Wa.exports;
  rl = 1;
  var r = dt(),
    t = Wv();
  return (
    (Wa.exports = function (e, n) {
      return t[e] || (t[e] = n !== void 0 ? n : {});
    })('versions', []).push({
      version: '3.6.4',
      mode: r ? 'pure' : 'global',
      copyright: '© 2020 Denis Pushkarev (zloirock.ru)',
    }),
    Wa.exports
  );
}
var Ga, tl;
function ia() {
  if (tl) return Ga;
  tl = 1;
  var r = 0,
    t = Math.random();
  return (
    (Ga = function (e) {
      return 'Symbol(' + String(e === void 0 ? '' : e) + ')_' + (++r + t).toString(36);
    }),
    Ga
  );
}
var Va, nl;
function oa() {
  if (nl) return Va;
  nl = 1;
  var r = Vs(),
    t = ia(),
    e = r('keys');
  return (
    (Va = function (n) {
      return e[n] || (e[n] = t(n));
    }),
    Va
  );
}
var $a, al;
function sa() {
  return al || ((al = 1), ($a = {})), $a;
}
var Ka, il;
function Jr() {
  if (il) return Ka;
  il = 1;
  var r = $y(),
    t = Re(),
    e = Je(),
    n = gr(),
    a = ar(),
    i = oa(),
    o = sa(),
    s = t.WeakMap,
    u,
    l,
    c,
    h = function (_) {
      return c(_) ? l(_) : u(_, {});
    },
    d = function (_) {
      return function (g) {
        var b;
        if (!e(g) || (b = l(g)).type !== _) throw TypeError('Incompatible receiver, ' + _ + ' required');
        return b;
      };
    };
  if (r) {
    var f = new s(),
      p = f.get,
      v = f.has,
      y = f.set;
    (u = function (_, g) {
      return y.call(f, _, g), g;
    }),
      (l = function (_) {
        return p.call(f, _) || {};
      }),
      (c = function (_) {
        return v.call(f, _);
      });
  } else {
    var E = i('state');
    (o[E] = !0),
      (u = function (_, g) {
        return n(_, E, g), g;
      }),
      (l = function (_) {
        return a(_, E) ? _[E] : {};
      }),
      (c = function (_) {
        return a(_, E);
      });
  }
  return (Ka = { set: u, get: l, has: c, enforce: h, getterFor: d }), Ka;
}
var ol;
function Er() {
  if (ol) return Da.exports;
  ol = 1;
  var r = Re(),
    t = gr(),
    e = ar(),
    n = Hs(),
    a = Gs(),
    i = Jr(),
    o = i.get,
    s = i.enforce,
    u = String(String).split('String');
  return (
    (Da.exports = function (l, c, h, d) {
      var f = d ? !!d.unsafe : !1,
        p = d ? !!d.enumerable : !1,
        v = d ? !!d.noTargetGet : !1;
      if (
        (typeof h == 'function' &&
          (typeof c == 'string' && !e(h, 'name') && t(h, 'name', c),
          (s(h).source = u.join(typeof c == 'string' ? c : ''))),
        l === r)
      ) {
        p ? (l[c] = h) : n(c, h);
        return;
      } else f ? !v && l[c] && (p = !0) : delete l[c];
      p ? (l[c] = h) : t(l, c, h);
    })(Function.prototype, 'toString', function () {
      return (typeof this == 'function' && o(this).source) || a(this);
    }),
    Da.exports
  );
}
var Za, sl;
function Hv() {
  if (sl) return Za;
  sl = 1;
  var r = Re();
  return (Za = r), Za;
}
var Xa, ul;
function Qr() {
  if (ul) return Xa;
  ul = 1;
  var r = Hv(),
    t = Re(),
    e = function (n) {
      return typeof n == 'function' ? n : void 0;
    };
  return (
    (Xa = function (n, a) {
      return arguments.length < 2 ? e(r[n]) || e(t[n]) : (r[n] && r[n][a]) || (t[n] && t[n][a]);
    }),
    Xa
  );
}
var Ya = {},
  Ja,
  ll;
function jr() {
  if (ll) return Ja;
  ll = 1;
  var r = Math.ceil,
    t = Math.floor;
  return (
    (Ja = function (e) {
      return isNaN((e = +e)) ? 0 : (e > 0 ? t : r)(e);
    }),
    Ja
  );
}
var Qa, cl;
function Ke() {
  if (cl) return Qa;
  cl = 1;
  var r = jr(),
    t = Math.min;
  return (
    (Qa = function (e) {
      return e > 0 ? t(r(e), 9007199254740991) : 0;
    }),
    Qa
  );
}
var ei, fl;
function zt() {
  if (fl) return ei;
  fl = 1;
  var r = jr(),
    t = Math.max,
    e = Math.min;
  return (
    (ei = function (n, a) {
      var i = r(n);
      return i < 0 ? t(i + a, 0) : e(i, a);
    }),
    ei
  );
}
var ri, hl;
function ua() {
  if (hl) return ri;
  hl = 1;
  var r = Or(),
    t = Ke(),
    e = zt(),
    n = function (a) {
      return function (i, o, s) {
        var u = r(i),
          l = t(u.length),
          c = e(s, l),
          h;
        if (a && o != o) {
          for (; l > c; ) if (((h = u[c++]), h != h)) return !0;
        } else for (; l > c; c++) if ((a || c in u) && u[c] === o) return a || c || 0;
        return !a && -1;
      };
    };
  return (ri = { includes: n(!0), indexOf: n(!1) }), ri;
}
var ti, dl;
function Gv() {
  if (dl) return ti;
  dl = 1;
  var r = ar(),
    t = Or(),
    e = ua().indexOf,
    n = sa();
  return (
    (ti = function (a, i) {
      var o = t(a),
        s = 0,
        u = [],
        l;
      for (l in o) !r(n, l) && r(o, l) && u.push(l);
      for (; i.length > s; ) r(o, (l = i[s++])) && (~e(u, l) || u.push(l));
      return u;
    }),
    ti
  );
}
var ni, pl;
function $s() {
  return (
    pl ||
      ((pl = 1),
      (ni = [
        'constructor',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toLocaleString',
        'toString',
        'valueOf',
      ])),
    ni
  );
}
var vl;
function Wt() {
  if (vl) return Ya;
  vl = 1;
  var r = Gv(),
    t = $s(),
    e = t.concat('length', 'prototype');
  return (
    (Ya.f =
      Object.getOwnPropertyNames ||
      function (a) {
        return r(a, e);
      }),
    Ya
  );
}
var ai = {},
  ml;
function Ks() {
  return ml || ((ml = 1), (ai.f = Object.getOwnPropertySymbols)), ai;
}
var ii, yl;
function Vv() {
  if (yl) return ii;
  yl = 1;
  var r = Qr(),
    t = Wt(),
    e = Ks(),
    n = sr();
  return (
    (ii =
      r('Reflect', 'ownKeys') ||
      function (i) {
        var o = t.f(n(i)),
          s = e.f;
        return s ? o.concat(s(i)) : o;
      }),
    ii
  );
}
var oi, gl;
function $v() {
  if (gl) return oi;
  gl = 1;
  var r = ar(),
    t = Vv(),
    e = Yr(),
    n = ur();
  return (
    (oi = function (a, i) {
      for (var o = t(i), s = n.f, u = e.f, l = 0; l < o.length; l++) {
        var c = o[l];
        r(a, c) || s(a, c, u(i, c));
      }
    }),
    oi
  );
}
var si, bl;
function Zs() {
  if (bl) return si;
  bl = 1;
  var r = Ee(),
    t = /#|\.prototype\./,
    e = function (s, u) {
      var l = a[n(s)];
      return l == o ? !0 : l == i ? !1 : typeof u == 'function' ? r(u) : !!u;
    },
    n = (e.normalize = function (s) {
      return String(s).replace(t, '.').toLowerCase();
    }),
    a = (e.data = {}),
    i = (e.NATIVE = 'N'),
    o = (e.POLYFILL = 'P');
  return (si = e), si;
}
var ui, _l;
function ge() {
  if (_l) return ui;
  _l = 1;
  var r = Re(),
    t = Yr().f,
    e = gr(),
    n = Er(),
    a = Hs(),
    i = $v(),
    o = Zs();
  return (
    (ui = function (s, u) {
      var l = s.target,
        c = s.global,
        h = s.stat,
        d,
        f,
        p,
        v,
        y,
        E;
      if ((c ? (f = r) : h ? (f = r[l] || a(l, {})) : (f = (r[l] || {}).prototype), f))
        for (p in u) {
          if (
            ((y = u[p]),
            s.noTargetGet ? ((E = t(f, p)), (v = E && E.value)) : (v = f[p]),
            (d = o(c ? p : l + (h ? '.' : '#') + p, s.forced)),
            !d && v !== void 0)
          ) {
            if (typeof y == typeof v) continue;
            i(y, v);
          }
          (s.sham || (v && v.sham)) && e(y, 'sham', !0), n(f, p, y, s);
        }
    }),
    ui
  );
}
var li, wl;
function Xs() {
  if (wl) return li;
  wl = 1;
  var r = Ee();
  return (
    (li =
      !!Object.getOwnPropertySymbols &&
      !r(function () {
        return !String(Symbol());
      })),
    li
  );
}
var ci, Sl;
function Kv() {
  if (Sl) return ci;
  Sl = 1;
  var r = Xs();
  return (ci = r && !Symbol.sham && typeof Symbol.iterator == 'symbol'), ci;
}
var fi, kl;
function bn() {
  if (kl) return fi;
  kl = 1;
  var r = Gr();
  return (
    (fi =
      Array.isArray ||
      function (e) {
        return r(e) == 'Array';
      }),
    fi
  );
}
var hi, El;
function lr() {
  if (El) return hi;
  El = 1;
  var r = ht();
  return (
    (hi = function (t) {
      return Object(r(t));
    }),
    hi
  );
}
var di, Al;
function _n() {
  if (Al) return di;
  Al = 1;
  var r = Gv(),
    t = $s();
  return (
    (di =
      Object.keys ||
      function (n) {
        return r(n, t);
      }),
    di
  );
}
var pi, Rl;
function Zv() {
  if (Rl) return pi;
  Rl = 1;
  var r = Ye(),
    t = ur(),
    e = sr(),
    n = _n();
  return (
    (pi = r
      ? Object.defineProperties
      : function (i, o) {
          e(i);
          for (var s = n(o), u = s.length, l = 0, c; u > l; ) t.f(i, (c = s[l++]), o[c]);
          return i;
        }),
    pi
  );
}
var vi, Tl;
function Xv() {
  if (Tl) return vi;
  Tl = 1;
  var r = Qr();
  return (vi = r('document', 'documentElement')), vi;
}
var mi, xl;
function xt() {
  if (xl) return mi;
  xl = 1;
  var r = sr(),
    t = Zv(),
    e = $s(),
    n = sa(),
    a = Xv(),
    i = Ws(),
    o = oa(),
    s = '>',
    u = '<',
    l = 'prototype',
    c = 'script',
    h = o('IE_PROTO'),
    d = function () {},
    f = function (_) {
      return u + c + s + _ + u + '/' + c + s;
    },
    p = function (_) {
      _.write(f('')), _.close();
      var g = _.parentWindow.Object;
      return (_ = null), g;
    },
    v = function () {
      var _ = i('iframe'),
        g = 'java' + c + ':',
        b;
      return (
        (_.style.display = 'none'),
        a.appendChild(_),
        (_.src = String(g)),
        (b = _.contentWindow.document),
        b.open(),
        b.write(f('document.F=Object')),
        b.close(),
        b.F
      );
    },
    y,
    E = function () {
      try {
        y = document.domain && new ActiveXObject('htmlfile');
      } catch {}
      E = y ? p(y) : v();
      for (var _ = e.length; _--; ) delete E[l][e[_]];
      return E();
    };
  return (
    (n[h] = !0),
    (mi =
      Object.create ||
      function (g, b) {
        var A;
        return (
          g !== null ? ((d[l] = r(g)), (A = new d()), (d[l] = null), (A[h] = g)) : (A = E()), b === void 0 ? A : t(A, b)
        );
      }),
    mi
  );
}
var yi = {},
  Pl;
function Yv() {
  if (Pl) return yi;
  Pl = 1;
  var r = Or(),
    t = Wt().f,
    e = {}.toString,
    n = typeof window == 'object' && window && Object.getOwnPropertyNames ? Object.getOwnPropertyNames(window) : [],
    a = function (i) {
      try {
        return t(i);
      } catch {
        return n.slice();
      }
    };
  return (
    (yi.f = function (o) {
      return n && e.call(o) == '[object Window]' ? a(o) : t(r(o));
    }),
    yi
  );
}
var gi, Il;
function Pe() {
  if (Il) return gi;
  Il = 1;
  var r = Re(),
    t = Vs(),
    e = ar(),
    n = ia(),
    a = Xs(),
    i = Kv(),
    o = t('wks'),
    s = r.Symbol,
    u = i ? s : (s && s.withoutSetter) || n;
  return (
    (gi = function (l) {
      return e(o, l) || (a && e(s, l) ? (o[l] = s[l]) : (o[l] = u('Symbol.' + l))), o[l];
    }),
    gi
  );
}
var bi = {},
  Cl;
function Jv() {
  if (Cl) return bi;
  Cl = 1;
  var r = Pe();
  return (bi.f = r), bi;
}
var _i, Ol;
function Ht() {
  if (Ol) return _i;
  Ol = 1;
  var r = Hv(),
    t = ar(),
    e = Jv(),
    n = ur().f;
  return (
    (_i = function (a) {
      var i = r.Symbol || (r.Symbol = {});
      t(i, a) || n(i, a, { value: e.f(a) });
    }),
    _i
  );
}
var wi, Nl;
function et() {
  if (Nl) return wi;
  Nl = 1;
  var r = ur().f,
    t = ar(),
    e = Pe(),
    n = e('toStringTag');
  return (
    (wi = function (a, i, o) {
      a && !t((a = o ? a : a.prototype), n) && r(a, n, { configurable: !0, value: i });
    }),
    wi
  );
}
var Si, Ml;
function Vr() {
  return (
    Ml ||
      ((Ml = 1),
      (Si = function (r) {
        if (typeof r != 'function') throw TypeError(String(r) + ' is not a function');
        return r;
      })),
    Si
  );
}
var ki, Fl;
function Pt() {
  if (Fl) return ki;
  Fl = 1;
  var r = Vr();
  return (
    (ki = function (t, e, n) {
      if ((r(t), e === void 0)) return t;
      switch (n) {
        case 0:
          return function () {
            return t.call(e);
          };
        case 1:
          return function (a) {
            return t.call(e, a);
          };
        case 2:
          return function (a, i) {
            return t.call(e, a, i);
          };
        case 3:
          return function (a, i, o) {
            return t.call(e, a, i, o);
          };
      }
      return function () {
        return t.apply(e, arguments);
      };
    }),
    ki
  );
}
var Ei, ql;
function la() {
  if (ql) return Ei;
  ql = 1;
  var r = Je(),
    t = bn(),
    e = Pe(),
    n = e('species');
  return (
    (Ei = function (a, i) {
      var o;
      return (
        t(a) &&
          ((o = a.constructor),
          typeof o == 'function' && (o === Array || t(o.prototype))
            ? (o = void 0)
            : r(o) && ((o = o[n]), o === null && (o = void 0))),
        new (o === void 0 ? Array : o)(i === 0 ? 0 : i)
      );
    }),
    Ei
  );
}
var Ai, Bl;
function br() {
  if (Bl) return Ai;
  Bl = 1;
  var r = Pt(),
    t = gn(),
    e = lr(),
    n = Ke(),
    a = la(),
    i = [].push,
    o = function (s) {
      var u = s == 1,
        l = s == 2,
        c = s == 3,
        h = s == 4,
        d = s == 6,
        f = s == 5 || d;
      return function (p, v, y, E) {
        for (
          var _ = e(p),
            g = t(_),
            b = r(v, y, 3),
            A = n(g.length),
            w = 0,
            T = E || a,
            P = u ? T(p, A) : l ? T(p, 0) : void 0,
            x,
            C;
          A > w;
          w++
        )
          if ((f || w in g) && ((x = g[w]), (C = b(x, w, _)), s)) {
            if (u) P[w] = C;
            else if (C)
              switch (s) {
                case 3:
                  return !0;
                case 5:
                  return x;
                case 6:
                  return w;
                case 2:
                  i.call(P, x);
              }
            else if (h) return !1;
          }
        return d ? -1 : c || h ? h : P;
      };
    };
  return (Ai = { forEach: o(0), map: o(1), filter: o(2), some: o(3), every: o(4), find: o(5), findIndex: o(6) }), Ai;
}
var Dl;
function Ky() {
  if (Dl) return Cu;
  Dl = 1;
  var r = ge(),
    t = Re(),
    e = Qr(),
    n = dt(),
    a = Ye(),
    i = Xs(),
    o = Kv(),
    s = Ee(),
    u = ar(),
    l = bn(),
    c = Je(),
    h = sr(),
    d = lr(),
    f = Or(),
    p = Tt(),
    v = Rt(),
    y = xt(),
    E = _n(),
    _ = Wt(),
    g = Yv(),
    b = Ks(),
    A = Yr(),
    w = ur(),
    T = aa(),
    P = gr(),
    x = Er(),
    C = Vs(),
    q = oa(),
    L = sa(),
    ae = ia(),
    te = Pe(),
    k = Jv(),
    m = Ht(),
    R = et(),
    I = Jr(),
    M = br().forEach,
    U = q('hidden'),
    N = 'Symbol',
    Z = 'prototype',
    ne = te('toPrimitive'),
    oe = I.set,
    fe = I.getterFor(N),
    Y = Object[Z],
    z = t.Symbol,
    Q = e('JSON', 'stringify'),
    ue = A.f,
    G = w.f,
    ie = g.f,
    K = T.f,
    D = C('symbols'),
    ee = C('op-symbols'),
    he = C('string-to-symbol-registry'),
    we = C('symbol-to-string-registry'),
    De = C('wks'),
    He = t.QObject,
    Fe = !He || !He[Z] || !He[Z].findChild,
    Se =
      a &&
      s(function () {
        return (
          y(
            G({}, 'a', {
              get: function () {
                return G(this, 'a', { value: 7 }).a;
              },
            })
          ).a != 7
        );
      })
        ? function (re, J, se) {
            var de = ue(Y, J);
            de && delete Y[J], G(re, J, se), de && re !== Y && G(Y, J, de);
          }
        : G,
    Qe = function (re, J) {
      var se = (D[re] = y(z[Z]));
      return oe(se, { type: N, tag: re, description: J }), a || (se.description = J), se;
    },
    dr = o
      ? function (re) {
          return typeof re == 'symbol';
        }
      : function (re) {
          return Object(re) instanceof z;
        },
    rr = function (J, se, de) {
      J === Y && rr(ee, se, de), h(J);
      var me = p(se, !0);
      return (
        h(de),
        u(D, me)
          ? (de.enumerable
              ? (u(J, U) && J[U][me] && (J[U][me] = !1), (de = y(de, { enumerable: v(0, !1) })))
              : (u(J, U) || G(J, U, v(1, {})), (J[U][me] = !0)),
            Se(J, me, de))
          : G(J, me, de)
      );
    },
    pr = function (J, se) {
      h(J);
      var de = f(se),
        me = E(de).concat(ce(de));
      return (
        M(me, function (Ue) {
          (!a || Te.call(de, Ue)) && rr(J, Ue, de[Ue]);
        }),
        J
      );
    },
    _r = function (J, se) {
      return se === void 0 ? y(J) : pr(y(J), se);
    },
    Te = function (J) {
      var se = p(J, !0),
        de = K.call(this, se);
      return this === Y && u(D, se) && !u(ee, se)
        ? !1
        : de || !u(this, se) || !u(D, se) || (u(this, U) && this[U][se])
        ? de
        : !0;
    },
    X = function (J, se) {
      var de = f(J),
        me = p(se, !0);
      if (!(de === Y && u(D, me) && !u(ee, me))) {
        var Ue = ue(de, me);
        return Ue && u(D, me) && !(u(de, U) && de[U][me]) && (Ue.enumerable = !0), Ue;
      }
    },
    $ = function (J) {
      var se = ie(f(J)),
        de = [];
      return (
        M(se, function (me) {
          !u(D, me) && !u(L, me) && de.push(me);
        }),
        de
      );
    },
    ce = function (J) {
      var se = J === Y,
        de = ie(se ? ee : f(J)),
        me = [];
      return (
        M(de, function (Ue) {
          u(D, Ue) && (!se || u(Y, Ue)) && me.push(D[Ue]);
        }),
        me
      );
    };
  if (
    (i ||
      ((z = function () {
        if (this instanceof z) throw TypeError('Symbol is not a constructor');
        var J = !arguments.length || arguments[0] === void 0 ? void 0 : String(arguments[0]),
          se = ae(J),
          de = function (me) {
            this === Y && de.call(ee, me), u(this, U) && u(this[U], se) && (this[U][se] = !1), Se(this, se, v(1, me));
          };
        return a && Fe && Se(Y, se, { configurable: !0, set: de }), Qe(se, J);
      }),
      x(z[Z], 'toString', function () {
        return fe(this).tag;
      }),
      x(z, 'withoutSetter', function (re) {
        return Qe(ae(re), re);
      }),
      (T.f = Te),
      (w.f = rr),
      (A.f = X),
      (_.f = g.f = $),
      (b.f = ce),
      (k.f = function (re) {
        return Qe(te(re), re);
      }),
      a &&
        (G(z[Z], 'description', {
          configurable: !0,
          get: function () {
            return fe(this).description;
          },
        }),
        n || x(Y, 'propertyIsEnumerable', Te, { unsafe: !0 }))),
    r({ global: !0, wrap: !0, forced: !i, sham: !i }, { Symbol: z }),
    M(E(De), function (re) {
      m(re);
    }),
    r(
      { target: N, stat: !0, forced: !i },
      {
        for: function (re) {
          var J = String(re);
          if (u(he, J)) return he[J];
          var se = z(J);
          return (he[J] = se), (we[se] = J), se;
        },
        keyFor: function (J) {
          if (!dr(J)) throw TypeError(J + ' is not a symbol');
          if (u(we, J)) return we[J];
        },
        useSetter: function () {
          Fe = !0;
        },
        useSimple: function () {
          Fe = !1;
        },
      }
    ),
    r(
      { target: 'Object', stat: !0, forced: !i, sham: !a },
      { create: _r, defineProperty: rr, defineProperties: pr, getOwnPropertyDescriptor: X }
    ),
    r({ target: 'Object', stat: !0, forced: !i }, { getOwnPropertyNames: $, getOwnPropertySymbols: ce }),
    r(
      {
        target: 'Object',
        stat: !0,
        forced: s(function () {
          b.f(1);
        }),
      },
      {
        getOwnPropertySymbols: function (J) {
          return b.f(d(J));
        },
      }
    ),
    Q)
  ) {
    var ve =
      !i ||
      s(function () {
        var re = z();
        return Q([re]) != '[null]' || Q({ a: re }) != '{}' || Q(Object(re)) != '{}';
      });
    r(
      { target: 'JSON', stat: !0, forced: ve },
      {
        stringify: function (J, se, de) {
          for (var me = [J], Ue = 1, er; arguments.length > Ue; ) me.push(arguments[Ue++]);
          if (((er = se), !((!c(se) && J === void 0) || dr(J))))
            return (
              l(se) ||
                (se = function (Ge, cr) {
                  if ((typeof er == 'function' && (cr = er.call(this, Ge, cr)), !dr(cr))) return cr;
                }),
              (me[1] = se),
              Q.apply(null, me)
            );
        },
      }
    );
  }
  return z[Z][ne] || P(z[Z], ne, z[Z].valueOf), R(z, N), (L[U] = !0), Cu;
}
Ky();
var jl = {},
  Ll;
function Zy() {
  if (Ll) return jl;
  Ll = 1;
  var r = ge(),
    t = Ye(),
    e = Re(),
    n = ar(),
    a = Je(),
    i = ur().f,
    o = $v(),
    s = e.Symbol;
  if (t && typeof s == 'function' && (!('description' in s.prototype) || s().description !== void 0)) {
    var u = {},
      l = function () {
        var v = arguments.length < 1 || arguments[0] === void 0 ? void 0 : String(arguments[0]),
          y = this instanceof l ? new s(v) : v === void 0 ? s() : s(v);
        return v === '' && (u[y] = !0), y;
      };
    o(l, s);
    var c = (l.prototype = s.prototype);
    c.constructor = l;
    var h = c.toString,
      d = String(s('test')) == 'Symbol(test)',
      f = /^Symbol\((.*)\)[^)]+$/;
    i(c, 'description', {
      configurable: !0,
      get: function () {
        var v = a(this) ? this.valueOf() : this,
          y = h.call(v);
        if (n(u, v)) return '';
        var E = d ? y.slice(7, -1) : y.replace(f, '$1');
        return E === '' ? void 0 : E;
      },
    }),
      r({ global: !0, forced: !0 }, { Symbol: l });
  }
  return jl;
}
Zy();
var Ul = {},
  zl;
function Xy() {
  if (zl) return Ul;
  zl = 1;
  var r = Ht();
  return r('asyncIterator'), Ul;
}
Xy();
var Wl = {},
  Hl;
function Yy() {
  if (Hl) return Wl;
  Hl = 1;
  var r = Ht();
  return r('hasInstance'), Wl;
}
Yy();
var Gl = {},
  Vl;
function Jy() {
  if (Vl) return Gl;
  Vl = 1;
  var r = Ht();
  return r('iterator'), Gl;
}
Jy();
var $l = {},
  Kl;
function Qy() {
  if (Kl) return $l;
  Kl = 1;
  var r = Ht();
  return r('toPrimitive'), $l;
}
Qy();
var Zl = {},
  Xl;
function eg() {
  if (Xl) return Zl;
  Xl = 1;
  var r = Ht();
  return r('toStringTag'), Zl;
}
eg();
var Yl = {},
  Ri,
  Jl;
function wn() {
  if (Jl) return Ri;
  Jl = 1;
  var r = Tt(),
    t = ur(),
    e = Rt();
  return (
    (Ri = function (n, a, i) {
      var o = r(a);
      o in n ? t.f(n, o, e(0, i)) : (n[o] = i);
    }),
    Ri
  );
}
var Ti, Ql;
function Qv() {
  if (Ql) return Ti;
  Ql = 1;
  var r = Qr();
  return (Ti = r('navigator', 'userAgent') || ''), Ti;
}
var xi, ec;
function Ys() {
  if (ec) return xi;
  ec = 1;
  var r = Re(),
    t = Qv(),
    e = r.process,
    n = e && e.versions,
    a = n && n.v8,
    i,
    o;
  return (
    a
      ? ((i = a.split('.')), (o = i[0] + i[1]))
      : t && ((i = t.match(/Edge\/(\d+)/)), (!i || i[1] >= 74) && ((i = t.match(/Chrome\/(\d+)/)), i && (o = i[1]))),
    (xi = o && +o),
    xi
  );
}
var Pi, rc;
function Sn() {
  if (rc) return Pi;
  rc = 1;
  var r = Ee(),
    t = Pe(),
    e = Ys(),
    n = t('species');
  return (
    (Pi = function (a) {
      return (
        e >= 51 ||
        !r(function () {
          var i = [],
            o = (i.constructor = {});
          return (
            (o[n] = function () {
              return { foo: 1 };
            }),
            i[a](Boolean).foo !== 1
          );
        })
      );
    }),
    Pi
  );
}
var tc;
function rg() {
  if (tc) return Yl;
  tc = 1;
  var r = ge(),
    t = Ee(),
    e = bn(),
    n = Je(),
    a = lr(),
    i = Ke(),
    o = wn(),
    s = la(),
    u = Sn(),
    l = Pe(),
    c = Ys(),
    h = l('isConcatSpreadable'),
    d = 9007199254740991,
    f = 'Maximum allowed index exceeded',
    p =
      c >= 51 ||
      !t(function () {
        var _ = [];
        return (_[h] = !1), _.concat()[0] !== _;
      }),
    v = u('concat'),
    y = function (_) {
      if (!n(_)) return !1;
      var g = _[h];
      return g !== void 0 ? !!g : e(_);
    },
    E = !p || !v;
  return (
    r(
      { target: 'Array', proto: !0, forced: E },
      {
        concat: function (g) {
          var b = a(this),
            A = s(b, 0),
            w = 0,
            T,
            P,
            x,
            C,
            q;
          for (T = -1, x = arguments.length; T < x; T++)
            if (((q = T === -1 ? b : arguments[T]), y(q))) {
              if (((C = i(q.length)), w + C > d)) throw TypeError(f);
              for (P = 0; P < C; P++, w++) P in q && o(A, w, q[P]);
            } else {
              if (w >= d) throw TypeError(f);
              o(A, w++, q);
            }
          return (A.length = w), A;
        },
      }
    ),
    Yl
  );
}
rg();
var nc = {},
  Ii,
  ac;
function Js() {
  if (ac) return Ii;
  ac = 1;
  var r = lr(),
    t = zt(),
    e = Ke();
  return (
    (Ii = function (a) {
      for (
        var i = r(this),
          o = e(i.length),
          s = arguments.length,
          u = t(s > 1 ? arguments[1] : void 0, o),
          l = s > 2 ? arguments[2] : void 0,
          c = l === void 0 ? o : t(l, o);
        c > u;

      )
        i[u++] = a;
      return i;
    }),
    Ii
  );
}
var Ci, ic;
function Gt() {
  if (ic) return Ci;
  ic = 1;
  var r = Pe(),
    t = xt(),
    e = ur(),
    n = r('unscopables'),
    a = Array.prototype;
  return (
    a[n] == null && e.f(a, n, { configurable: !0, value: t(null) }),
    (Ci = function (i) {
      a[n][i] = !0;
    }),
    Ci
  );
}
var oc;
function tg() {
  if (oc) return nc;
  oc = 1;
  var r = ge(),
    t = Js(),
    e = Gt();
  return r({ target: 'Array', proto: !0 }, { fill: t }), e('fill'), nc;
}
tg();
var sc = {},
  Oi,
  uc;
function rt() {
  if (uc) return Oi;
  uc = 1;
  var r = Ye(),
    t = Ee(),
    e = ar(),
    n = Object.defineProperty,
    a = {},
    i = function (o) {
      throw o;
    };
  return (
    (Oi = function (o, s) {
      if (e(a, o)) return a[o];
      s || (s = {});
      var u = [][o],
        l = e(s, 'ACCESSORS') ? s.ACCESSORS : !1,
        c = e(s, 0) ? s[0] : i,
        h = e(s, 1) ? s[1] : void 0;
      return (a[o] =
        !!u &&
        !t(function () {
          if (l && !r) return !0;
          var d = { length: -1 };
          l ? n(d, 1, { enumerable: !0, get: i }) : (d[1] = 1), u.call(d, c, h);
        }));
    }),
    Oi
  );
}
var lc;
function ng() {
  if (lc) return sc;
  lc = 1;
  var r = ge(),
    t = br().filter,
    e = Sn(),
    n = rt(),
    a = e('filter'),
    i = n('filter');
  return (
    r(
      { target: 'Array', proto: !0, forced: !a || !i },
      {
        filter: function (s) {
          return t(this, s, arguments.length > 1 ? arguments[1] : void 0);
        },
      }
    ),
    sc
  );
}
ng();
var cc = {},
  fc;
function ag() {
  if (fc) return cc;
  fc = 1;
  var r = ge(),
    t = br().find,
    e = Gt(),
    n = rt(),
    a = 'find',
    i = !0,
    o = n(a);
  return (
    a in [] &&
      Array(1)[a](function () {
        i = !1;
      }),
    r(
      { target: 'Array', proto: !0, forced: i || !o },
      {
        find: function (u) {
          return t(this, u, arguments.length > 1 ? arguments[1] : void 0);
        },
      }
    ),
    e(a),
    cc
  );
}
ag();
var hc = {},
  dc;
function ig() {
  if (dc) return hc;
  dc = 1;
  var r = ge(),
    t = br().findIndex,
    e = Gt(),
    n = rt(),
    a = 'findIndex',
    i = !0,
    o = n(a);
  return (
    a in [] &&
      Array(1)[a](function () {
        i = !1;
      }),
    r(
      { target: 'Array', proto: !0, forced: i || !o },
      {
        findIndex: function (u) {
          return t(this, u, arguments.length > 1 ? arguments[1] : void 0);
        },
      }
    ),
    e(a),
    hc
  );
}
ig();
var pc = {},
  Ni,
  vc;
function og() {
  if (vc) return Ni;
  vc = 1;
  var r = bn(),
    t = Ke(),
    e = Pt(),
    n = function (a, i, o, s, u, l, c, h) {
      for (var d = u, f = 0, p = c ? e(c, h, 3) : !1, v; f < s; ) {
        if (f in o) {
          if (((v = p ? p(o[f], f, i) : o[f]), l > 0 && r(v))) d = n(a, i, v, t(v.length), d, l - 1) - 1;
          else {
            if (d >= 9007199254740991) throw TypeError('Exceed the acceptable array length');
            a[d] = v;
          }
          d++;
        }
        f++;
      }
      return d;
    };
  return (Ni = n), Ni;
}
var mc;
function sg() {
  if (mc) return pc;
  mc = 1;
  var r = ge(),
    t = og(),
    e = lr(),
    n = Ke(),
    a = Vr(),
    i = la();
  return (
    r(
      { target: 'Array', proto: !0 },
      {
        flatMap: function (s) {
          var u = e(this),
            l = n(u.length),
            c;
          return (
            a(s), (c = i(u, 0)), (c.length = t(c, u, u, l, 0, 1, s, arguments.length > 1 ? arguments[1] : void 0)), c
          );
        },
      }
    ),
    pc
  );
}
sg();
var yc = {},
  Mi,
  gc;
function em() {
  if (gc) return Mi;
  gc = 1;
  var r = sr();
  return (
    (Mi = function (t, e, n, a) {
      try {
        return a ? e(r(n)[0], n[1]) : e(n);
      } catch (o) {
        var i = t.return;
        throw (i !== void 0 && r(i.call(t)), o);
      }
    }),
    Mi
  );
}
var Fi, bc;
function kn() {
  return bc || ((bc = 1), (Fi = {})), Fi;
}
var qi, _c;
function Qs() {
  if (_c) return qi;
  _c = 1;
  var r = Pe(),
    t = kn(),
    e = r('iterator'),
    n = Array.prototype;
  return (
    (qi = function (a) {
      return a !== void 0 && (t.Array === a || n[e] === a);
    }),
    qi
  );
}
var Bi, wc;
function eu() {
  if (wc) return Bi;
  wc = 1;
  var r = Pe(),
    t = r('toStringTag'),
    e = {};
  return (e[t] = 'z'), (Bi = String(e) === '[object z]'), Bi;
}
var Di, Sc;
function En() {
  if (Sc) return Di;
  Sc = 1;
  var r = eu(),
    t = Gr(),
    e = Pe(),
    n = e('toStringTag'),
    a =
      t(
        (function () {
          return arguments;
        })()
      ) == 'Arguments',
    i = function (o, s) {
      try {
        return o[s];
      } catch {}
    };
  return (
    (Di = r
      ? t
      : function (o) {
          var s, u, l;
          return o === void 0
            ? 'Undefined'
            : o === null
            ? 'Null'
            : typeof (u = i((s = Object(o)), n)) == 'string'
            ? u
            : a
            ? t(s)
            : (l = t(s)) == 'Object' && typeof s.callee == 'function'
            ? 'Arguments'
            : l;
        }),
    Di
  );
}
var ji, kc;
function An() {
  if (kc) return ji;
  kc = 1;
  var r = En(),
    t = kn(),
    e = Pe(),
    n = e('iterator');
  return (
    (ji = function (a) {
      if (a != null) return a[n] || a['@@iterator'] || t[r(a)];
    }),
    ji
  );
}
var Li, Ec;
function rm() {
  if (Ec) return Li;
  Ec = 1;
  var r = Pt(),
    t = lr(),
    e = em(),
    n = Qs(),
    a = Ke(),
    i = wn(),
    o = An();
  return (
    (Li = function (u) {
      var l = t(u),
        c = typeof this == 'function' ? this : Array,
        h = arguments.length,
        d = h > 1 ? arguments[1] : void 0,
        f = d !== void 0,
        p = o(l),
        v = 0,
        y,
        E,
        _,
        g,
        b,
        A;
      if ((f && (d = r(d, h > 2 ? arguments[2] : void 0, 2)), p != null && !(c == Array && n(p))))
        for (g = p.call(l), b = g.next, E = new c(); !(_ = b.call(g)).done; v++)
          (A = f ? e(g, d, [_.value, v], !0) : _.value), i(E, v, A);
      else for (y = a(l.length), E = new c(y); y > v; v++) (A = f ? d(l[v], v) : l[v]), i(E, v, A);
      return (E.length = v), E;
    }),
    Li
  );
}
var Ui, Ac;
function ru() {
  if (Ac) return Ui;
  Ac = 1;
  var r = Pe(),
    t = r('iterator'),
    e = !1;
  try {
    var n = 0,
      a = {
        next: function () {
          return { done: !!n++ };
        },
        return: function () {
          e = !0;
        },
      };
    (a[t] = function () {
      return this;
    }),
      Array.from(a, function () {
        throw 2;
      });
  } catch {}
  return (
    (Ui = function (i, o) {
      if (!o && !e) return !1;
      var s = !1;
      try {
        var u = {};
        (u[t] = function () {
          return {
            next: function () {
              return { done: (s = !0) };
            },
          };
        }),
          i(u);
      } catch {}
      return s;
    }),
    Ui
  );
}
var Rc;
function ug() {
  if (Rc) return yc;
  Rc = 1;
  var r = ge(),
    t = rm(),
    e = ru(),
    n = !e(function (a) {
      Array.from(a);
    });
  return r({ target: 'Array', stat: !0, forced: n }, { from: t }), yc;
}
ug();
var Tc = {},
  xc;
function lg() {
  if (xc) return Tc;
  xc = 1;
  var r = ge(),
    t = ua().includes,
    e = Gt(),
    n = rt(),
    a = n('indexOf', { ACCESSORS: !0, 1: 0 });
  return (
    r(
      { target: 'Array', proto: !0, forced: !a },
      {
        includes: function (o) {
          return t(this, o, arguments.length > 1 ? arguments[1] : void 0);
        },
      }
    ),
    e('includes'),
    Tc
  );
}
lg();
var zi, Pc;
function tm() {
  if (Pc) return zi;
  Pc = 1;
  var r = Ee();
  return (
    (zi = !r(function () {
      function t() {}
      return (t.prototype.constructor = null), Object.getPrototypeOf(new t()) !== t.prototype;
    })),
    zi
  );
}
var Wi, Ic;
function Vt() {
  if (Ic) return Wi;
  Ic = 1;
  var r = ar(),
    t = lr(),
    e = oa(),
    n = tm(),
    a = e('IE_PROTO'),
    i = Object.prototype;
  return (
    (Wi = n
      ? Object.getPrototypeOf
      : function (o) {
          return (
            (o = t(o)),
            r(o, a)
              ? o[a]
              : typeof o.constructor == 'function' && o instanceof o.constructor
              ? o.constructor.prototype
              : o instanceof Object
              ? i
              : null
          );
        }),
    Wi
  );
}
var Hi, Cc;
function nm() {
  if (Cc) return Hi;
  Cc = 1;
  var r = Vt(),
    t = gr(),
    e = ar(),
    n = Pe(),
    a = dt(),
    i = n('iterator'),
    o = !1,
    s = function () {
      return this;
    },
    u,
    l,
    c;
  return (
    [].keys && ((c = [].keys()), 'next' in c ? ((l = r(r(c))), l !== Object.prototype && (u = l)) : (o = !0)),
    u == null && (u = {}),
    !a && !e(u, i) && t(u, i, s),
    (Hi = { IteratorPrototype: u, BUGGY_SAFARI_ITERATORS: o }),
    Hi
  );
}
var Gi, Oc;
function am() {
  if (Oc) return Gi;
  Oc = 1;
  var r = nm().IteratorPrototype,
    t = xt(),
    e = Rt(),
    n = et(),
    a = kn(),
    i = function () {
      return this;
    };
  return (
    (Gi = function (o, s, u) {
      var l = s + ' Iterator';
      return (o.prototype = t(r, { next: e(1, u) })), n(o, l, !1, !0), (a[l] = i), o;
    }),
    Gi
  );
}
var Vi, Nc;
function cg() {
  if (Nc) return Vi;
  Nc = 1;
  var r = Je();
  return (
    (Vi = function (t) {
      if (!r(t) && t !== null) throw TypeError("Can't set " + String(t) + ' as a prototype');
      return t;
    }),
    Vi
  );
}
var $i, Mc;
function Rn() {
  if (Mc) return $i;
  Mc = 1;
  var r = sr(),
    t = cg();
  return (
    ($i =
      Object.setPrototypeOf ||
      ('__proto__' in {}
        ? (function () {
            var e = !1,
              n = {},
              a;
            try {
              (a = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__').set),
                a.call(n, []),
                (e = n instanceof Array);
            } catch {}
            return function (o, s) {
              return r(o), t(s), e ? a.call(o, s) : (o.__proto__ = s), o;
            };
          })()
        : void 0)),
    $i
  );
}
var Ki, Fc;
function im() {
  if (Fc) return Ki;
  Fc = 1;
  var r = ge(),
    t = am(),
    e = Vt(),
    n = Rn(),
    a = et(),
    i = gr(),
    o = Er(),
    s = Pe(),
    u = dt(),
    l = kn(),
    c = nm(),
    h = c.IteratorPrototype,
    d = c.BUGGY_SAFARI_ITERATORS,
    f = s('iterator'),
    p = 'keys',
    v = 'values',
    y = 'entries',
    E = function () {
      return this;
    };
  return (
    (Ki = function (_, g, b, A, w, T, P) {
      t(b, g, A);
      var x = function (M) {
          if (M === w && te) return te;
          if (!d && M in L) return L[M];
          switch (M) {
            case p:
              return function () {
                return new b(this, M);
              };
            case v:
              return function () {
                return new b(this, M);
              };
            case y:
              return function () {
                return new b(this, M);
              };
          }
          return function () {
            return new b(this);
          };
        },
        C = g + ' Iterator',
        q = !1,
        L = _.prototype,
        ae = L[f] || L['@@iterator'] || (w && L[w]),
        te = (!d && ae) || x(w),
        k = (g == 'Array' && L.entries) || ae,
        m,
        R,
        I;
      if (
        (k &&
          ((m = e(k.call(new _()))),
          h !== Object.prototype &&
            m.next &&
            (!u && e(m) !== h && (n ? n(m, h) : typeof m[f] != 'function' && i(m, f, E)),
            a(m, C, !0, !0),
            u && (l[C] = E))),
        w == v &&
          ae &&
          ae.name !== v &&
          ((q = !0),
          (te = function () {
            return ae.call(this);
          })),
        (!u || P) && L[f] !== te && i(L, f, te),
        (l[g] = te),
        w)
      )
        if (((R = { values: x(v), keys: T ? te : x(p), entries: x(y) }), P))
          for (I in R) (d || q || !(I in L)) && o(L, I, R[I]);
        else r({ target: g, proto: !0, forced: d || q }, R);
      return R;
    }),
    Ki
  );
}
var Zi, qc;
function ca() {
  if (qc) return Zi;
  qc = 1;
  var r = Or(),
    t = Gt(),
    e = kn(),
    n = Jr(),
    a = im(),
    i = 'Array Iterator',
    o = n.set,
    s = n.getterFor(i);
  return (
    (Zi = a(
      Array,
      'Array',
      function (u, l) {
        o(this, { type: i, target: r(u), index: 0, kind: l });
      },
      function () {
        var u = s(this),
          l = u.target,
          c = u.kind,
          h = u.index++;
        return !l || h >= l.length
          ? ((u.target = void 0), { value: void 0, done: !0 })
          : c == 'keys'
          ? { value: h, done: !1 }
          : c == 'values'
          ? { value: l[h], done: !1 }
          : { value: [h, l[h]], done: !1 };
      },
      'values'
    )),
    (e.Arguments = e.Array),
    t('keys'),
    t('values'),
    t('entries'),
    Zi
  );
}
ca();
var Bc = {},
  Xi,
  Dc;
function fa() {
  if (Dc) return Xi;
  Dc = 1;
  var r = Ee();
  return (
    (Xi = function (t, e) {
      var n = [][t];
      return (
        !!n &&
        r(function () {
          n.call(
            null,
            e ||
              function () {
                throw 1;
              },
            1
          );
        })
      );
    }),
    Xi
  );
}
var jc;
function fg() {
  if (jc) return Bc;
  jc = 1;
  var r = ge(),
    t = gn(),
    e = Or(),
    n = fa(),
    a = [].join,
    i = t != Object,
    o = n('join', ',');
  return (
    r(
      { target: 'Array', proto: !0, forced: i || !o },
      {
        join: function (u) {
          return a.call(e(this), u === void 0 ? ',' : u);
        },
      }
    ),
    Bc
  );
}
fg();
var Lc = {},
  Uc;
function hg() {
  if (Uc) return Lc;
  Uc = 1;
  var r = ge(),
    t = br().map,
    e = Sn(),
    n = rt(),
    a = e('map'),
    i = n('map');
  return (
    r(
      { target: 'Array', proto: !0, forced: !a || !i },
      {
        map: function (s) {
          return t(this, s, arguments.length > 1 ? arguments[1] : void 0);
        },
      }
    ),
    Lc
  );
}
hg();
var zc = {},
  Wc;
function dg() {
  if (Wc) return zc;
  Wc = 1;
  var r = ge(),
    t = Je(),
    e = bn(),
    n = zt(),
    a = Ke(),
    i = Or(),
    o = wn(),
    s = Pe(),
    u = Sn(),
    l = rt(),
    c = u('slice'),
    h = l('slice', { ACCESSORS: !0, 0: 0, 1: 2 }),
    d = s('species'),
    f = [].slice,
    p = Math.max;
  return (
    r(
      { target: 'Array', proto: !0, forced: !c || !h },
      {
        slice: function (y, E) {
          var _ = i(this),
            g = a(_.length),
            b = n(y, g),
            A = n(E === void 0 ? g : E, g),
            w,
            T,
            P;
          if (
            e(_) &&
            ((w = _.constructor),
            typeof w == 'function' && (w === Array || e(w.prototype))
              ? (w = void 0)
              : t(w) && ((w = w[d]), w === null && (w = void 0)),
            w === Array || w === void 0)
          )
            return f.call(_, b, A);
          for (T = new (w === void 0 ? Array : w)(p(A - b, 0)), P = 0; b < A; b++, P++) b in _ && o(T, P, _[b]);
          return (T.length = P), T;
        },
      }
    ),
    zc
  );
}
dg();
var Hc = {},
  Gc;
function pg() {
  if (Gc) return Hc;
  Gc = 1;
  var r = ge(),
    t = Vr(),
    e = lr(),
    n = Ee(),
    a = fa(),
    i = [],
    o = i.sort,
    s = n(function () {
      i.sort(void 0);
    }),
    u = n(function () {
      i.sort(null);
    }),
    l = a('sort'),
    c = s || !u || !l;
  return (
    r(
      { target: 'Array', proto: !0, forced: c },
      {
        sort: function (d) {
          return d === void 0 ? o.call(e(this)) : o.call(e(this), t(d));
        },
      }
    ),
    Hc
  );
}
pg();
var Vc = {},
  $c;
function vg() {
  if ($c) return Vc;
  $c = 1;
  var r = ge(),
    t = zt(),
    e = jr(),
    n = Ke(),
    a = lr(),
    i = la(),
    o = wn(),
    s = Sn(),
    u = rt(),
    l = s('splice'),
    c = u('splice', { ACCESSORS: !0, 0: 0, 1: 2 }),
    h = Math.max,
    d = Math.min,
    f = 9007199254740991,
    p = 'Maximum allowed length exceeded';
  return (
    r(
      { target: 'Array', proto: !0, forced: !l || !c },
      {
        splice: function (y, E) {
          var _ = a(this),
            g = n(_.length),
            b = t(y, g),
            A = arguments.length,
            w,
            T,
            P,
            x,
            C,
            q;
          if (
            (A === 0 ? (w = T = 0) : A === 1 ? ((w = 0), (T = g - b)) : ((w = A - 2), (T = d(h(e(E), 0), g - b))),
            g + w - T > f)
          )
            throw TypeError(p);
          for (P = i(_, T), x = 0; x < T; x++) (C = b + x), C in _ && o(P, x, _[C]);
          if (((P.length = T), w < T)) {
            for (x = b; x < g - T; x++) (C = x + T), (q = x + w), C in _ ? (_[q] = _[C]) : delete _[q];
            for (x = g; x > g - T + w; x--) delete _[x - 1];
          } else if (w > T)
            for (x = g - T; x > b; x--) (C = x + T - 1), (q = x + w - 1), C in _ ? (_[q] = _[C]) : delete _[q];
          for (x = 0; x < w; x++) _[x + b] = arguments[x + 2];
          return (_.length = g - T + w), P;
        },
      }
    ),
    Vc
  );
}
vg();
var Kc = {},
  Zc;
function mg() {
  if (Zc) return Kc;
  Zc = 1;
  var r = Gt();
  return r('flatMap'), Kc;
}
mg();
var Xc = {},
  Yi,
  Yc;
function om() {
  return Yc || ((Yc = 1), (Yi = typeof ArrayBuffer < 'u' && typeof DataView < 'u')), Yi;
}
var Ji, Jc;
function tu() {
  if (Jc) return Ji;
  Jc = 1;
  var r = Er();
  return (
    (Ji = function (t, e, n) {
      for (var a in e) r(t, a, e[a], n);
      return t;
    }),
    Ji
  );
}
var Qi, Qc;
function Tn() {
  return (
    Qc ||
      ((Qc = 1),
      (Qi = function (r, t, e) {
        if (!(r instanceof t)) throw TypeError('Incorrect ' + (e ? e + ' ' : '') + 'invocation');
        return r;
      })),
    Qi
  );
}
var eo, ef;
function sm() {
  if (ef) return eo;
  ef = 1;
  var r = jr(),
    t = Ke();
  return (
    (eo = function (e) {
      if (e === void 0) return 0;
      var n = r(e),
        a = t(n);
      if (n !== a) throw RangeError('Wrong length or index');
      return a;
    }),
    eo
  );
}
var ro, rf;
function yg() {
  if (rf) return ro;
  rf = 1;
  var r = 1 / 0,
    t = Math.abs,
    e = Math.pow,
    n = Math.floor,
    a = Math.log,
    i = Math.LN2,
    o = function (u, l, c) {
      var h = new Array(c),
        d = c * 8 - l - 1,
        f = (1 << d) - 1,
        p = f >> 1,
        v = l === 23 ? e(2, -24) - e(2, -77) : 0,
        y = u < 0 || (u === 0 && 1 / u < 0) ? 1 : 0,
        E = 0,
        _,
        g,
        b;
      for (
        u = t(u),
          u != u || u === r
            ? ((g = u != u ? 1 : 0), (_ = f))
            : ((_ = n(a(u) / i)),
              u * (b = e(2, -_)) < 1 && (_--, (b *= 2)),
              _ + p >= 1 ? (u += v / b) : (u += v * e(2, 1 - p)),
              u * b >= 2 && (_++, (b /= 2)),
              _ + p >= f
                ? ((g = 0), (_ = f))
                : _ + p >= 1
                ? ((g = (u * b - 1) * e(2, l)), (_ = _ + p))
                : ((g = u * e(2, p - 1) * e(2, l)), (_ = 0)));
        l >= 8;
        h[E++] = g & 255, g /= 256, l -= 8
      );
      for (_ = (_ << l) | g, d += l; d > 0; h[E++] = _ & 255, _ /= 256, d -= 8);
      return (h[--E] |= y * 128), h;
    },
    s = function (u, l) {
      var c = u.length,
        h = c * 8 - l - 1,
        d = (1 << h) - 1,
        f = d >> 1,
        p = h - 7,
        v = c - 1,
        y = u[v--],
        E = y & 127,
        _;
      for (y >>= 7; p > 0; E = E * 256 + u[v], v--, p -= 8);
      for (_ = E & ((1 << -p) - 1), E >>= -p, p += l; p > 0; _ = _ * 256 + u[v], v--, p -= 8);
      if (E === 0) E = 1 - f;
      else {
        if (E === d) return _ ? NaN : y ? -r : r;
        (_ = _ + e(2, l)), (E = E - f);
      }
      return (y ? -1 : 1) * _ * e(2, E - l);
    };
  return (ro = { pack: o, unpack: s }), ro;
}
var to, tf;
function um() {
  if (tf) return to;
  tf = 1;
  var r = Re(),
    t = Ye(),
    e = om(),
    n = gr(),
    a = tu(),
    i = Ee(),
    o = Tn(),
    s = jr(),
    u = Ke(),
    l = sm(),
    c = yg(),
    h = Vt(),
    d = Rn(),
    f = Wt().f,
    p = ur().f,
    v = Js(),
    y = et(),
    E = Jr(),
    _ = E.get,
    g = E.set,
    b = 'ArrayBuffer',
    A = 'DataView',
    w = 'prototype',
    T = 'Wrong length',
    P = 'Wrong index',
    x = r[b],
    C = x,
    q = r[A],
    L = q && q[w],
    ae = Object.prototype,
    te = r.RangeError,
    k = c.pack,
    m = c.unpack,
    R = function (K) {
      return [K & 255];
    },
    I = function (K) {
      return [K & 255, (K >> 8) & 255];
    },
    M = function (K) {
      return [K & 255, (K >> 8) & 255, (K >> 16) & 255, (K >> 24) & 255];
    },
    U = function (K) {
      return (K[3] << 24) | (K[2] << 16) | (K[1] << 8) | K[0];
    },
    N = function (K) {
      return k(K, 23, 4);
    },
    Z = function (K) {
      return k(K, 52, 8);
    },
    ne = function (K, D) {
      p(K[w], D, {
        get: function () {
          return _(this)[D];
        },
      });
    },
    oe = function (K, D, ee, he) {
      var we = l(ee),
        De = _(K);
      if (we + D > De.byteLength) throw te(P);
      var He = _(De.buffer).bytes,
        Fe = we + De.byteOffset,
        Se = He.slice(Fe, Fe + D);
      return he ? Se : Se.reverse();
    },
    fe = function (K, D, ee, he, we, De) {
      var He = l(ee),
        Fe = _(K);
      if (He + D > Fe.byteLength) throw te(P);
      for (var Se = _(Fe.buffer).bytes, Qe = He + Fe.byteOffset, dr = he(+we), rr = 0; rr < D; rr++)
        Se[Qe + rr] = dr[De ? rr : D - rr - 1];
    };
  if (!e)
    (C = function (D) {
      o(this, C, b);
      var ee = l(D);
      g(this, { bytes: v.call(new Array(ee), 0), byteLength: ee }), t || (this.byteLength = ee);
    }),
      (q = function (D, ee, he) {
        o(this, q, A), o(D, C, A);
        var we = _(D).byteLength,
          De = s(ee);
        if (De < 0 || De > we) throw te('Wrong offset');
        if (((he = he === void 0 ? we - De : u(he)), De + he > we)) throw te(T);
        g(this, { buffer: D, byteLength: he, byteOffset: De }),
          t || ((this.buffer = D), (this.byteLength = he), (this.byteOffset = De));
      }),
      t && (ne(C, 'byteLength'), ne(q, 'buffer'), ne(q, 'byteLength'), ne(q, 'byteOffset')),
      a(q[w], {
        getInt8: function (D) {
          return (oe(this, 1, D)[0] << 24) >> 24;
        },
        getUint8: function (D) {
          return oe(this, 1, D)[0];
        },
        getInt16: function (D) {
          var ee = oe(this, 2, D, arguments.length > 1 ? arguments[1] : void 0);
          return (((ee[1] << 8) | ee[0]) << 16) >> 16;
        },
        getUint16: function (D) {
          var ee = oe(this, 2, D, arguments.length > 1 ? arguments[1] : void 0);
          return (ee[1] << 8) | ee[0];
        },
        getInt32: function (D) {
          return U(oe(this, 4, D, arguments.length > 1 ? arguments[1] : void 0));
        },
        getUint32: function (D) {
          return U(oe(this, 4, D, arguments.length > 1 ? arguments[1] : void 0)) >>> 0;
        },
        getFloat32: function (D) {
          return m(oe(this, 4, D, arguments.length > 1 ? arguments[1] : void 0), 23);
        },
        getFloat64: function (D) {
          return m(oe(this, 8, D, arguments.length > 1 ? arguments[1] : void 0), 52);
        },
        setInt8: function (D, ee) {
          fe(this, 1, D, R, ee);
        },
        setUint8: function (D, ee) {
          fe(this, 1, D, R, ee);
        },
        setInt16: function (D, ee) {
          fe(this, 2, D, I, ee, arguments.length > 2 ? arguments[2] : void 0);
        },
        setUint16: function (D, ee) {
          fe(this, 2, D, I, ee, arguments.length > 2 ? arguments[2] : void 0);
        },
        setInt32: function (D, ee) {
          fe(this, 4, D, M, ee, arguments.length > 2 ? arguments[2] : void 0);
        },
        setUint32: function (D, ee) {
          fe(this, 4, D, M, ee, arguments.length > 2 ? arguments[2] : void 0);
        },
        setFloat32: function (D, ee) {
          fe(this, 4, D, N, ee, arguments.length > 2 ? arguments[2] : void 0);
        },
        setFloat64: function (D, ee) {
          fe(this, 8, D, Z, ee, arguments.length > 2 ? arguments[2] : void 0);
        },
      });
  else {
    if (
      !i(function () {
        x(1);
      }) ||
      !i(function () {
        new x(-1);
      }) ||
      i(function () {
        return new x(), new x(1.5), new x(NaN), x.name != b;
      })
    ) {
      C = function (D) {
        return o(this, C), new x(l(D));
      };
      for (var Y = (C[w] = x[w]), z = f(x), Q = 0, ue; z.length > Q; ) (ue = z[Q++]) in C || n(C, ue, x[ue]);
      Y.constructor = C;
    }
    d && h(L) !== ae && d(L, ae);
    var G = new q(new C(2)),
      ie = L.setInt8;
    G.setInt8(0, 2147483648),
      G.setInt8(1, 2147483649),
      (G.getInt8(0) || !G.getInt8(1)) &&
        a(
          L,
          {
            setInt8: function (D, ee) {
              ie.call(this, D, (ee << 24) >> 24);
            },
            setUint8: function (D, ee) {
              ie.call(this, D, (ee << 24) >> 24);
            },
          },
          { unsafe: !0 }
        );
  }
  return y(C, b), y(q, A), (to = { ArrayBuffer: C, DataView: q }), to;
}
var no, nf;
function nu() {
  if (nf) return no;
  nf = 1;
  var r = Qr(),
    t = ur(),
    e = Pe(),
    n = Ye(),
    a = e('species');
  return (
    (no = function (i) {
      var o = r(i),
        s = t.f;
      n &&
        o &&
        !o[a] &&
        s(o, a, {
          configurable: !0,
          get: function () {
            return this;
          },
        });
    }),
    no
  );
}
var af;
function gg() {
  if (af) return Xc;
  af = 1;
  var r = ge(),
    t = Re(),
    e = um(),
    n = nu(),
    a = 'ArrayBuffer',
    i = e[a],
    o = t[a];
  return r({ global: !0, forced: o !== i }, { ArrayBuffer: i }), n(a), Xc;
}
gg();
var of = {},
  ao,
  sf;
function bg() {
  if (sf) return ao;
  sf = 1;
  var r = sr(),
    t = Tt();
  return (
    (ao = function (e) {
      if (e !== 'string' && e !== 'number' && e !== 'default') throw TypeError('Incorrect hint');
      return t(r(this), e !== 'number');
    }),
    ao
  );
}
var uf;
function _g() {
  if (uf) return of;
  uf = 1;
  var r = gr(),
    t = bg(),
    e = Pe(),
    n = e('toPrimitive'),
    a = Date.prototype;
  return n in a || r(a, n, t), of;
}
_g();
var lf = {},
  cf;
function wg() {
  if (cf) return lf;
  cf = 1;
  var r = Je(),
    t = ur(),
    e = Vt(),
    n = Pe(),
    a = n('hasInstance'),
    i = Function.prototype;
  return (
    a in i ||
      t.f(i, a, {
        value: function (o) {
          if (typeof this != 'function' || !r(o)) return !1;
          if (!r(this.prototype)) return o instanceof this;
          for (; (o = e(o)); ) if (this.prototype === o) return !0;
          return !1;
        },
      }),
    lf
  );
}
wg();
var ff = {},
  hf;
function Sg() {
  if (hf) return ff;
  hf = 1;
  var r = Ye(),
    t = ur().f,
    e = Function.prototype,
    n = e.toString,
    a = /^\s*function ([^ (]*)/,
    i = 'name';
  return (
    r &&
      !(i in e) &&
      t(e, i, {
        configurable: !0,
        get: function () {
          try {
            return n.call(this).match(a)[1];
          } catch {
            return '';
          }
        },
      }),
    ff
  );
}
Sg();
var df = {},
  pf;
function kg() {
  if (pf) return df;
  pf = 1;
  var r = Re(),
    t = et();
  return t(r.JSON, 'JSON', !0), df;
}
kg();
var vf = {},
  mf;
function Eg() {
  if (mf) return vf;
  mf = 1;
  var r = et();
  return r(Math, 'Math', !0), vf;
}
Eg();
var yf = {},
  io,
  gf;
function lm() {
  if (gf) return io;
  gf = 1;
  var r = Je(),
    t = Rn();
  return (
    (io = function (e, n, a) {
      var i, o;
      return (
        t &&
          typeof (i = n.constructor) == 'function' &&
          i !== a &&
          r((o = i.prototype)) &&
          o !== a.prototype &&
          t(e, o),
        e
      );
    }),
    io
  );
}
var oo, bf;
function cm() {
  return (
    bf ||
      ((bf = 1),
      (oo = `	
\v\f\r                　\u2028\u2029\uFEFF`)),
    oo
  );
}
var so, _f;
function fm() {
  if (_f) return so;
  _f = 1;
  var r = ht(),
    t = cm(),
    e = '[' + t + ']',
    n = RegExp('^' + e + e + '*'),
    a = RegExp(e + e + '*$'),
    i = function (o) {
      return function (s) {
        var u = String(r(s));
        return o & 1 && (u = u.replace(n, '')), o & 2 && (u = u.replace(a, '')), u;
      };
    };
  return (so = { start: i(1), end: i(2), trim: i(3) }), so;
}
var wf;
function Ag() {
  if (wf) return yf;
  wf = 1;
  var r = Ye(),
    t = Re(),
    e = Zs(),
    n = Er(),
    a = ar(),
    i = Gr(),
    o = lm(),
    s = Tt(),
    u = Ee(),
    l = xt(),
    c = Wt().f,
    h = Yr().f,
    d = ur().f,
    f = fm().trim,
    p = 'Number',
    v = t[p],
    y = v.prototype,
    E = i(l(y)) == p,
    _ = function (T) {
      var P = s(T, !1),
        x,
        C,
        q,
        L,
        ae,
        te,
        k,
        m;
      if (typeof P == 'string' && P.length > 2) {
        if (((P = f(P)), (x = P.charCodeAt(0)), x === 43 || x === 45)) {
          if (((C = P.charCodeAt(2)), C === 88 || C === 120)) return NaN;
        } else if (x === 48) {
          switch (P.charCodeAt(1)) {
            case 66:
            case 98:
              (q = 2), (L = 49);
              break;
            case 79:
            case 111:
              (q = 8), (L = 55);
              break;
            default:
              return +P;
          }
          for (ae = P.slice(2), te = ae.length, k = 0; k < te; k++)
            if (((m = ae.charCodeAt(k)), m < 48 || m > L)) return NaN;
          return parseInt(ae, q);
        }
      }
      return +P;
    };
  if (e(p, !v(' 0o1') || !v('0b1') || v('+0x1'))) {
    for (
      var g = function (P) {
          var x = arguments.length < 1 ? 0 : P,
            C = this;
          return C instanceof g &&
            (E
              ? u(function () {
                  y.valueOf.call(C);
                })
              : i(C) != p)
            ? o(new v(_(x)), C, g)
            : _(x);
        },
        b = r
          ? c(v)
          : 'MAX_VALUE,MIN_VALUE,NaN,NEGATIVE_INFINITY,POSITIVE_INFINITY,EPSILON,isFinite,isInteger,isNaN,isSafeInteger,MAX_SAFE_INTEGER,MIN_SAFE_INTEGER,parseFloat,parseInt,isInteger'.split(
              ','
            ),
        A = 0,
        w;
      b.length > A;
      A++
    )
      a(v, (w = b[A])) && !a(g, w) && d(g, w, h(v, w));
    (g.prototype = y), (y.constructor = g), n(t, p, g);
  }
  return yf;
}
Ag();
var Sf = {},
  uo,
  kf;
function Rg() {
  if (kf) return uo;
  kf = 1;
  var r = Gr();
  return (
    (uo = function (t) {
      if (typeof t != 'number' && r(t) != 'Number') throw TypeError('Incorrect invocation');
      return +t;
    }),
    uo
  );
}
var lo, Ef;
function Tg() {
  if (Ef) return lo;
  Ef = 1;
  var r = jr(),
    t = ht();
  return (
    (lo =
      ''.repeat ||
      function (n) {
        var a = String(t(this)),
          i = '',
          o = r(n);
        if (o < 0 || o == 1 / 0) throw RangeError('Wrong number of repetitions');
        for (; o > 0; (o >>>= 1) && (a += a)) o & 1 && (i += a);
        return i;
      }),
    lo
  );
}
var Af;
function xg() {
  if (Af) return Sf;
  Af = 1;
  var r = ge(),
    t = jr(),
    e = Rg(),
    n = Tg(),
    a = Ee(),
    i = (1).toFixed,
    o = Math.floor,
    s = function (c, h, d) {
      return h === 0 ? d : h % 2 === 1 ? s(c, h - 1, d * c) : s(c * c, h / 2, d);
    },
    u = function (c) {
      for (var h = 0, d = c; d >= 4096; ) (h += 12), (d /= 4096);
      for (; d >= 2; ) (h += 1), (d /= 2);
      return h;
    },
    l =
      (i &&
        ((8e-5).toFixed(3) !== '0.000' ||
          (0.9).toFixed(0) !== '1' ||
          (1.255).toFixed(2) !== '1.25' ||
          (0xde0b6b3a7640080).toFixed(0) !== '1000000000000000128')) ||
      !a(function () {
        i.call({});
      });
  return (
    r(
      { target: 'Number', proto: !0, forced: l },
      {
        toFixed: function (h) {
          var d = e(this),
            f = t(h),
            p = [0, 0, 0, 0, 0, 0],
            v = '',
            y = '0',
            E,
            _,
            g,
            b,
            A = function (P, x) {
              for (var C = -1, q = x; ++C < 6; ) (q += P * p[C]), (p[C] = q % 1e7), (q = o(q / 1e7));
            },
            w = function (P) {
              for (var x = 6, C = 0; --x >= 0; ) (C += p[x]), (p[x] = o(C / P)), (C = (C % P) * 1e7);
            },
            T = function () {
              for (var P = 6, x = ''; --P >= 0; )
                if (x !== '' || P === 0 || p[P] !== 0) {
                  var C = String(p[P]);
                  x = x === '' ? C : x + n.call('0', 7 - C.length) + C;
                }
              return x;
            };
          if (f < 0 || f > 20) throw RangeError('Incorrect fraction digits');
          if (d != d) return 'NaN';
          if (d <= -1e21 || d >= 1e21) return String(d);
          if ((d < 0 && ((v = '-'), (d = -d)), d > 1e-21))
            if (
              ((E = u(d * s(2, 69, 1)) - 69),
              (_ = E < 0 ? d * s(2, -E, 1) : d / s(2, E, 1)),
              (_ *= 4503599627370496),
              (E = 52 - E),
              E > 0)
            ) {
              for (A(0, _), g = f; g >= 7; ) A(1e7, 0), (g -= 7);
              for (A(s(10, g, 1), 0), g = E - 1; g >= 23; ) w(1 << 23), (g -= 23);
              w(1 << g), A(1, 1), w(2), (y = T());
            } else A(0, _), A(1 << -E, 0), (y = T() + n.call('0', f));
          return (
            f > 0
              ? ((b = y.length),
                (y = v + (b <= f ? '0.' + n.call('0', f - b) + y : y.slice(0, b - f) + '.' + y.slice(b - f))))
              : (y = v + y),
            y
          );
        },
      }
    ),
    Sf
  );
}
xg();
var Rf = {},
  co,
  Tf;
function hm() {
  if (Tf) return co;
  Tf = 1;
  var r = Ye(),
    t = Ee(),
    e = _n(),
    n = Ks(),
    a = aa(),
    i = lr(),
    o = gn(),
    s = Object.assign,
    u = Object.defineProperty;
  return (
    (co =
      !s ||
      t(function () {
        if (
          r &&
          s(
            { b: 1 },
            s(
              u({}, 'a', {
                enumerable: !0,
                get: function () {
                  u(this, 'b', { value: 3, enumerable: !1 });
                },
              }),
              { b: 2 }
            )
          ).b !== 1
        )
          return !0;
        var l = {},
          c = {},
          h = Symbol(),
          d = 'abcdefghijklmnopqrst';
        return (
          (l[h] = 7),
          d.split('').forEach(function (f) {
            c[f] = f;
          }),
          s({}, l)[h] != 7 || e(s({}, c)).join('') != d
        );
      })
        ? function (c, h) {
            for (var d = i(c), f = arguments.length, p = 1, v = n.f, y = a.f; f > p; )
              for (var E = o(arguments[p++]), _ = v ? e(E).concat(v(E)) : e(E), g = _.length, b = 0, A; g > b; )
                (A = _[b++]), (!r || y.call(E, A)) && (d[A] = E[A]);
            return d;
          }
        : s),
    co
  );
}
var xf;
function Pg() {
  if (xf) return Rf;
  xf = 1;
  var r = ge(),
    t = hm();
  return r({ target: 'Object', stat: !0, forced: Object.assign !== t }, { assign: t }), Rf;
}
Pg();
var Pf = {},
  fo,
  If;
function Ig() {
  if (If) return fo;
  If = 1;
  var r = Ye(),
    t = _n(),
    e = Or(),
    n = aa().f,
    a = function (i) {
      return function (o) {
        for (var s = e(o), u = t(s), l = u.length, c = 0, h = [], d; l > c; )
          (d = u[c++]), (!r || n.call(s, d)) && h.push(i ? [d, s[d]] : s[d]);
        return h;
      };
    };
  return (fo = { entries: a(!0), values: a(!1) }), fo;
}
var Cf;
function Cg() {
  if (Cf) return Pf;
  Cf = 1;
  var r = ge(),
    t = Ig().entries;
  return (
    r(
      { target: 'Object', stat: !0 },
      {
        entries: function (n) {
          return t(n);
        },
      }
    ),
    Pf
  );
}
Cg();
var Of = {},
  Nf;
function Og() {
  if (Nf) return Of;
  Nf = 1;
  var r = ge(),
    t = Ee(),
    e = Or(),
    n = Yr().f,
    a = Ye(),
    i = t(function () {
      n(1);
    }),
    o = !a || i;
  return (
    r(
      { target: 'Object', stat: !0, forced: o, sham: !a },
      {
        getOwnPropertyDescriptor: function (u, l) {
          return n(e(u), l);
        },
      }
    ),
    Of
  );
}
Og();
var Mf = {},
  Ff;
function Ng() {
  if (Ff) return Mf;
  Ff = 1;
  var r = ge(),
    t = Ye(),
    e = Vv(),
    n = Or(),
    a = Yr(),
    i = wn();
  return (
    r(
      { target: 'Object', stat: !0, sham: !t },
      {
        getOwnPropertyDescriptors: function (s) {
          for (var u = n(s), l = a.f, c = e(u), h = {}, d = 0, f, p; c.length > d; )
            (p = l(u, (f = c[d++]))), p !== void 0 && i(h, f, p);
          return h;
        },
      }
    ),
    Mf
  );
}
Ng();
var qf = {},
  Bf;
function Mg() {
  if (Bf) return qf;
  Bf = 1;
  var r = ge(),
    t = Ee(),
    e = Yv().f,
    n = t(function () {
      return !Object.getOwnPropertyNames(1);
    });
  return r({ target: 'Object', stat: !0, forced: n }, { getOwnPropertyNames: e }), qf;
}
Mg();
var Df = {},
  jf;
function Fg() {
  if (jf) return Df;
  jf = 1;
  var r = ge(),
    t = Ee(),
    e = lr(),
    n = Vt(),
    a = tm(),
    i = t(function () {
      n(1);
    });
  return (
    r(
      { target: 'Object', stat: !0, forced: i, sham: !a },
      {
        getPrototypeOf: function (s) {
          return n(e(s));
        },
      }
    ),
    Df
  );
}
Fg();
var Lf = {},
  Uf;
function qg() {
  if (Uf) return Lf;
  Uf = 1;
  var r = ge(),
    t = lr(),
    e = _n(),
    n = Ee(),
    a = n(function () {
      e(1);
    });
  return (
    r(
      { target: 'Object', stat: !0, forced: a },
      {
        keys: function (o) {
          return e(t(o));
        },
      }
    ),
    Lf
  );
}
qg();
var zf = {},
  ho,
  Wf;
function Bg() {
  if (Wf) return ho;
  Wf = 1;
  var r = eu(),
    t = En();
  return (
    (ho = r
      ? {}.toString
      : function () {
          return '[object ' + t(this) + ']';
        }),
    ho
  );
}
var Hf;
function Dg() {
  if (Hf) return zf;
  Hf = 1;
  var r = eu(),
    t = Er(),
    e = Bg();
  return r || t(Object.prototype, 'toString', e, { unsafe: !0 }), zf;
}
Dg();
var Gf = {},
  po,
  Vf;
function dm() {
  if (Vf) return po;
  Vf = 1;
  var r = Re();
  return (po = r.Promise), po;
}
var vo = { exports: {} },
  $f;
function pm() {
  if ($f) return vo.exports;
  $f = 1;
  var r = sr(),
    t = Qs(),
    e = Ke(),
    n = Pt(),
    a = An(),
    i = em(),
    o = function (u, l) {
      (this.stopped = u), (this.result = l);
    },
    s = (vo.exports = function (u, l, c, h, d) {
      var f = n(l, c, h ? 2 : 1),
        p,
        v,
        y,
        E,
        _,
        g,
        b;
      if (d) p = u;
      else {
        if (((v = a(u)), typeof v != 'function')) throw TypeError('Target is not iterable');
        if (t(v)) {
          for (y = 0, E = e(u.length); E > y; y++)
            if (((_ = h ? f(r((b = u[y]))[0], b[1]) : f(u[y])), _ && _ instanceof o)) return _;
          return new o(!1);
        }
        p = v.call(u);
      }
      for (g = p.next; !(b = g.call(p)).done; )
        if (((_ = i(p, f, b.value, h)), typeof _ == 'object' && _ && _ instanceof o)) return _;
      return new o(!1);
    });
  return (
    (s.stop = function (u) {
      return new o(!0, u);
    }),
    vo.exports
  );
}
var mo, Kf;
function $t() {
  if (Kf) return mo;
  Kf = 1;
  var r = sr(),
    t = Vr(),
    e = Pe(),
    n = e('species');
  return (
    (mo = function (a, i) {
      var o = r(a).constructor,
        s;
      return o === void 0 || (s = r(o)[n]) == null ? i : t(s);
    }),
    mo
  );
}
var yo, Zf;
function vm() {
  if (Zf) return yo;
  Zf = 1;
  var r = Qv();
  return (yo = /(iphone|ipod|ipad).*applewebkit/i.test(r)), yo;
}
var go, Xf;
function mm() {
  if (Xf) return go;
  Xf = 1;
  var r = Re(),
    t = Ee(),
    e = Gr(),
    n = Pt(),
    a = Xv(),
    i = Ws(),
    o = vm(),
    s = r.location,
    u = r.setImmediate,
    l = r.clearImmediate,
    c = r.process,
    h = r.MessageChannel,
    d = r.Dispatch,
    f = 0,
    p = {},
    v = 'onreadystatechange',
    y,
    E,
    _,
    g = function (T) {
      if (p.hasOwnProperty(T)) {
        var P = p[T];
        delete p[T], P();
      }
    },
    b = function (T) {
      return function () {
        g(T);
      };
    },
    A = function (T) {
      g(T.data);
    },
    w = function (T) {
      r.postMessage(T + '', s.protocol + '//' + s.host);
    };
  return (
    (!u || !l) &&
      ((u = function (P) {
        for (var x = [], C = 1; arguments.length > C; ) x.push(arguments[C++]);
        return (
          (p[++f] = function () {
            (typeof P == 'function' ? P : Function(P)).apply(void 0, x);
          }),
          y(f),
          f
        );
      }),
      (l = function (P) {
        delete p[P];
      }),
      e(c) == 'process'
        ? (y = function (T) {
            c.nextTick(b(T));
          })
        : d && d.now
        ? (y = function (T) {
            d.now(b(T));
          })
        : h && !o
        ? ((E = new h()), (_ = E.port2), (E.port1.onmessage = A), (y = n(_.postMessage, _, 1)))
        : r.addEventListener && typeof postMessage == 'function' && !r.importScripts && !t(w)
        ? ((y = w), r.addEventListener('message', A, !1))
        : v in i('script')
        ? (y = function (T) {
            a.appendChild(i('script'))[v] = function () {
              a.removeChild(this), g(T);
            };
          })
        : (y = function (T) {
            setTimeout(b(T), 0);
          })),
    (go = { set: u, clear: l }),
    go
  );
}
var bo, Yf;
function jg() {
  if (Yf) return bo;
  Yf = 1;
  var r = Re(),
    t = Yr().f,
    e = Gr(),
    n = mm().set,
    a = vm(),
    i = r.MutationObserver || r.WebKitMutationObserver,
    o = r.process,
    s = r.Promise,
    u = e(o) == 'process',
    l = t(r, 'queueMicrotask'),
    c = l && l.value,
    h,
    d,
    f,
    p,
    v,
    y,
    E,
    _;
  return (
    c ||
      ((h = function () {
        var g, b;
        for (u && (g = o.domain) && g.exit(); d; ) {
          (b = d.fn), (d = d.next);
          try {
            b();
          } catch (A) {
            throw (d ? p() : (f = void 0), A);
          }
        }
        (f = void 0), g && g.enter();
      }),
      u
        ? (p = function () {
            o.nextTick(h);
          })
        : i && !a
        ? ((v = !0),
          (y = document.createTextNode('')),
          new i(h).observe(y, { characterData: !0 }),
          (p = function () {
            y.data = v = !v;
          }))
        : s && s.resolve
        ? ((E = s.resolve(void 0)),
          (_ = E.then),
          (p = function () {
            _.call(E, h);
          }))
        : (p = function () {
            n.call(r, h);
          })),
    (bo =
      c ||
      function (g) {
        var b = { fn: g, next: void 0 };
        f && (f.next = b), d || ((d = b), p()), (f = b);
      }),
    bo
  );
}
var _o = {},
  Jf;
function au() {
  if (Jf) return _o;
  Jf = 1;
  var r = Vr(),
    t = function (e) {
      var n, a;
      (this.promise = new e(function (i, o) {
        if (n !== void 0 || a !== void 0) throw TypeError('Bad Promise constructor');
        (n = i), (a = o);
      })),
        (this.resolve = r(n)),
        (this.reject = r(a));
    };
  return (
    (_o.f = function (e) {
      return new t(e);
    }),
    _o
  );
}
var wo, Qf;
function ym() {
  if (Qf) return wo;
  Qf = 1;
  var r = sr(),
    t = Je(),
    e = au();
  return (
    (wo = function (n, a) {
      if ((r(n), t(a) && a.constructor === n)) return a;
      var i = e.f(n),
        o = i.resolve;
      return o(a), i.promise;
    }),
    wo
  );
}
var So, eh;
function Lg() {
  if (eh) return So;
  eh = 1;
  var r = Re();
  return (
    (So = function (t, e) {
      var n = r.console;
      n && n.error && (arguments.length === 1 ? n.error(t) : n.error(t, e));
    }),
    So
  );
}
var ko, rh;
function gm() {
  return (
    rh ||
      ((rh = 1),
      (ko = function (r) {
        try {
          return { error: !1, value: r() };
        } catch (t) {
          return { error: !0, value: t };
        }
      })),
    ko
  );
}
var th;
function Ug() {
  if (th) return Gf;
  th = 1;
  var r = ge(),
    t = dt(),
    e = Re(),
    n = Qr(),
    a = dm(),
    i = Er(),
    o = tu(),
    s = et(),
    u = nu(),
    l = Je(),
    c = Vr(),
    h = Tn(),
    d = Gr(),
    f = Gs(),
    p = pm(),
    v = ru(),
    y = $t(),
    E = mm().set,
    _ = jg(),
    g = ym(),
    b = Lg(),
    A = au(),
    w = gm(),
    T = Jr(),
    P = Zs(),
    x = Pe(),
    C = Ys(),
    q = x('species'),
    L = 'Promise',
    ae = T.get,
    te = T.set,
    k = T.getterFor(L),
    m = a,
    R = e.TypeError,
    I = e.document,
    M = e.process,
    U = n('fetch'),
    N = A.f,
    Z = N,
    ne = d(M) == 'process',
    oe = !!(I && I.createEvent && e.dispatchEvent),
    fe = 'unhandledrejection',
    Y = 'rejectionhandled',
    z = 0,
    Q = 1,
    ue = 2,
    G = 1,
    ie = 2,
    K,
    D,
    ee,
    he,
    we = P(L, function () {
      var X = f(m) !== String(m);
      if ((!X && (C === 66 || (!ne && typeof PromiseRejectionEvent != 'function'))) || (t && !m.prototype.finally))
        return !0;
      if (C >= 51 && /native code/.test(m)) return !1;
      var $ = m.resolve(1),
        ce = function (re) {
          re(
            function () {},
            function () {}
          );
        },
        ve = ($.constructor = {});
      return (ve[q] = ce), !($.then(function () {}) instanceof ce);
    }),
    De =
      we ||
      !v(function (X) {
        m.all(X).catch(function () {});
      }),
    He = function (X) {
      var $;
      return l(X) && typeof ($ = X.then) == 'function' ? $ : !1;
    },
    Fe = function (X, $, ce) {
      if (!$.notified) {
        $.notified = !0;
        var ve = $.reactions;
        _(function () {
          for (var re = $.value, J = $.state == Q, se = 0; ve.length > se; ) {
            var de = ve[se++],
              me = J ? de.ok : de.fail,
              Ue = de.resolve,
              er = de.reject,
              Ge = de.domain,
              cr,
              wr,
              vr;
            try {
              me
                ? (J || ($.rejection === ie && rr(X, $), ($.rejection = G)),
                  me === !0 ? (cr = re) : (Ge && Ge.enter(), (cr = me(re)), Ge && (Ge.exit(), (vr = !0))),
                  cr === de.promise ? er(R('Promise-chain cycle')) : (wr = He(cr)) ? wr.call(cr, Ue, er) : Ue(cr))
                : er(re);
            } catch (Rr) {
              Ge && !vr && Ge.exit(), er(Rr);
            }
          }
          ($.reactions = []), ($.notified = !1), ce && !$.rejection && Qe(X, $);
        });
      }
    },
    Se = function (X, $, ce) {
      var ve, re;
      oe
        ? ((ve = I.createEvent('Event')),
          (ve.promise = $),
          (ve.reason = ce),
          ve.initEvent(X, !1, !0),
          e.dispatchEvent(ve))
        : (ve = { promise: $, reason: ce }),
        (re = e['on' + X]) ? re(ve) : X === fe && b('Unhandled promise rejection', ce);
    },
    Qe = function (X, $) {
      E.call(e, function () {
        var ce = $.value,
          ve = dr($),
          re;
        if (
          ve &&
          ((re = w(function () {
            ne ? M.emit('unhandledRejection', ce, X) : Se(fe, X, ce);
          })),
          ($.rejection = ne || dr($) ? ie : G),
          re.error)
        )
          throw re.value;
      });
    },
    dr = function (X) {
      return X.rejection !== G && !X.parent;
    },
    rr = function (X, $) {
      E.call(e, function () {
        ne ? M.emit('rejectionHandled', X) : Se(Y, X, $.value);
      });
    },
    pr = function (X, $, ce, ve) {
      return function (re) {
        X($, ce, re, ve);
      };
    },
    _r = function (X, $, ce, ve) {
      $.done || (($.done = !0), ve && ($ = ve), ($.value = ce), ($.state = ue), Fe(X, $, !0));
    },
    Te = function (X, $, ce, ve) {
      if (!$.done) {
        ($.done = !0), ve && ($ = ve);
        try {
          if (X === ce) throw R("Promise can't be resolved itself");
          var re = He(ce);
          re
            ? _(function () {
                var J = { done: !1 };
                try {
                  re.call(ce, pr(Te, X, J, $), pr(_r, X, J, $));
                } catch (se) {
                  _r(X, J, se, $);
                }
              })
            : (($.value = ce), ($.state = Q), Fe(X, $, !1));
        } catch (J) {
          _r(X, { done: !1 }, J, $);
        }
      }
    };
  return (
    we &&
      ((m = function ($) {
        h(this, m, L), c($), K.call(this);
        var ce = ae(this);
        try {
          $(pr(Te, this, ce), pr(_r, this, ce));
        } catch (ve) {
          _r(this, ce, ve);
        }
      }),
      (K = function ($) {
        te(this, {
          type: L,
          done: !1,
          notified: !1,
          parent: !1,
          reactions: [],
          rejection: !1,
          state: z,
          value: void 0,
        });
      }),
      (K.prototype = o(m.prototype, {
        then: function ($, ce) {
          var ve = k(this),
            re = N(y(this, m));
          return (
            (re.ok = typeof $ == 'function' ? $ : !0),
            (re.fail = typeof ce == 'function' && ce),
            (re.domain = ne ? M.domain : void 0),
            (ve.parent = !0),
            ve.reactions.push(re),
            ve.state != z && Fe(this, ve, !1),
            re.promise
          );
        },
        catch: function (X) {
          return this.then(void 0, X);
        },
      })),
      (D = function () {
        var X = new K(),
          $ = ae(X);
        (this.promise = X), (this.resolve = pr(Te, X, $)), (this.reject = pr(_r, X, $));
      }),
      (A.f = N =
        function (X) {
          return X === m || X === ee ? new D(X) : Z(X);
        }),
      !t &&
        typeof a == 'function' &&
        ((he = a.prototype.then),
        i(
          a.prototype,
          'then',
          function ($, ce) {
            var ve = this;
            return new m(function (re, J) {
              he.call(ve, re, J);
            }).then($, ce);
          },
          { unsafe: !0 }
        ),
        typeof U == 'function' &&
          r(
            { global: !0, enumerable: !0, forced: !0 },
            {
              fetch: function ($) {
                return g(m, U.apply(e, arguments));
              },
            }
          ))),
    r({ global: !0, wrap: !0, forced: we }, { Promise: m }),
    s(m, L, !1, !0),
    u(L),
    (ee = n(L)),
    r(
      { target: L, stat: !0, forced: we },
      {
        reject: function ($) {
          var ce = N(this);
          return ce.reject.call(void 0, $), ce.promise;
        },
      }
    ),
    r(
      { target: L, stat: !0, forced: t || we },
      {
        resolve: function ($) {
          return g(t && this === ee ? m : this, $);
        },
      }
    ),
    r(
      { target: L, stat: !0, forced: De },
      {
        all: function ($) {
          var ce = this,
            ve = N(ce),
            re = ve.resolve,
            J = ve.reject,
            se = w(function () {
              var de = c(ce.resolve),
                me = [],
                Ue = 0,
                er = 1;
              p($, function (Ge) {
                var cr = Ue++,
                  wr = !1;
                me.push(void 0),
                  er++,
                  de.call(ce, Ge).then(function (vr) {
                    wr || ((wr = !0), (me[cr] = vr), --er || re(me));
                  }, J);
              }),
                --er || re(me);
            });
          return se.error && J(se.value), ve.promise;
        },
        race: function ($) {
          var ce = this,
            ve = N(ce),
            re = ve.reject,
            J = w(function () {
              var se = c(ce.resolve);
              p($, function (de) {
                se.call(ce, de).then(ve.resolve, re);
              });
            });
          return J.error && re(J.value), ve.promise;
        },
      }
    ),
    Gf
  );
}
Ug();
var nh = {},
  ah;
function zg() {
  if (ah) return nh;
  ah = 1;
  var r = ge(),
    t = dt(),
    e = dm(),
    n = Ee(),
    a = Qr(),
    i = $t(),
    o = ym(),
    s = Er(),
    u =
      !!e &&
      n(function () {
        e.prototype.finally.call({ then: function () {} }, function () {});
      });
  return (
    r(
      { target: 'Promise', proto: !0, real: !0, forced: u },
      {
        finally: function (l) {
          var c = i(this, a('Promise')),
            h = typeof l == 'function';
          return this.then(
            h
              ? function (d) {
                  return o(c, l()).then(function () {
                    return d;
                  });
                }
              : l,
            h
              ? function (d) {
                  return o(c, l()).then(function () {
                    throw d;
                  });
                }
              : l
          );
        },
      }
    ),
    !t && typeof e == 'function' && !e.prototype.finally && s(e.prototype, 'finally', a('Promise').prototype.finally),
    nh
  );
}
zg();
var ih = {},
  Eo,
  oh;
function Wg() {
  if (oh) return Eo;
  oh = 1;
  var r = Vr(),
    t = Je(),
    e = [].slice,
    n = {},
    a = function (i, o, s) {
      if (!(o in n)) {
        for (var u = [], l = 0; l < o; l++) u[l] = 'a[' + l + ']';
        n[o] = Function('C,a', 'return new C(' + u.join(',') + ')');
      }
      return n[o](i, s);
    };
  return (
    (Eo =
      Function.bind ||
      function (o) {
        var s = r(this),
          u = e.call(arguments, 1),
          l = function () {
            var h = u.concat(e.call(arguments));
            return this instanceof l ? a(s, h.length, h) : s.apply(o, h);
          };
        return t(s.prototype) && (l.prototype = s.prototype), l;
      }),
    Eo
  );
}
var sh;
function Hg() {
  if (sh) return ih;
  sh = 1;
  var r = ge(),
    t = Qr(),
    e = Vr(),
    n = sr(),
    a = Je(),
    i = xt(),
    o = Wg(),
    s = Ee(),
    u = t('Reflect', 'construct'),
    l = s(function () {
      function d() {}
      return !(u(function () {}, [], d) instanceof d);
    }),
    c = !s(function () {
      u(function () {});
    }),
    h = l || c;
  return (
    r(
      { target: 'Reflect', stat: !0, forced: h, sham: h },
      {
        construct: function (f, p) {
          e(f), n(p);
          var v = arguments.length < 3 ? f : e(arguments[2]);
          if (c && !l) return u(f, p, v);
          if (f == v) {
            switch (p.length) {
              case 0:
                return new f();
              case 1:
                return new f(p[0]);
              case 2:
                return new f(p[0], p[1]);
              case 3:
                return new f(p[0], p[1], p[2]);
              case 4:
                return new f(p[0], p[1], p[2], p[3]);
            }
            var y = [null];
            return y.push.apply(y, p), new (o.apply(f, y))();
          }
          var E = v.prototype,
            _ = i(a(E) ? E : Object.prototype),
            g = Function.apply.call(f, _, p);
          return a(g) ? g : _;
        },
      }
    ),
    ih
  );
}
Hg();
var uh = {},
  Ao,
  lh;
function iu() {
  if (lh) return Ao;
  lh = 1;
  var r = sr();
  return (
    (Ao = function () {
      var t = r(this),
        e = '';
      return (
        t.global && (e += 'g'),
        t.ignoreCase && (e += 'i'),
        t.multiline && (e += 'm'),
        t.dotAll && (e += 's'),
        t.unicode && (e += 'u'),
        t.sticky && (e += 'y'),
        e
      );
    }),
    Ao
  );
}
var On = {},
  ch;
function bm() {
  if (ch) return On;
  ch = 1;
  var r = Ee();
  function t(e, n) {
    return RegExp(e, n);
  }
  return (
    (On.UNSUPPORTED_Y = r(function () {
      var e = t('a', 'y');
      return (e.lastIndex = 2), e.exec('abcd') != null;
    })),
    (On.BROKEN_CARET = r(function () {
      var e = t('^r', 'gy');
      return (e.lastIndex = 2), e.exec('str') != null;
    })),
    On
  );
}
var Ro, fh;
function ou() {
  if (fh) return Ro;
  fh = 1;
  var r = iu(),
    t = bm(),
    e = RegExp.prototype.exec,
    n = String.prototype.replace,
    a = e,
    i = (function () {
      var l = /a/,
        c = /b*/g;
      return e.call(l, 'a'), e.call(c, 'a'), l.lastIndex !== 0 || c.lastIndex !== 0;
    })(),
    o = t.UNSUPPORTED_Y || t.BROKEN_CARET,
    s = /()??/.exec('')[1] !== void 0,
    u = i || s || o;
  return (
    u &&
      (a = function (c) {
        var h = this,
          d,
          f,
          p,
          v,
          y = o && h.sticky,
          E = r.call(h),
          _ = h.source,
          g = 0,
          b = c;
        return (
          y &&
            ((E = E.replace('y', '')),
            E.indexOf('g') === -1 && (E += 'g'),
            (b = String(c).slice(h.lastIndex)),
            h.lastIndex > 0 &&
              (!h.multiline ||
                (h.multiline &&
                  c[h.lastIndex - 1] !==
                    `
`)) &&
              ((_ = '(?: ' + _ + ')'), (b = ' ' + b), g++),
            (f = new RegExp('^(?:' + _ + ')', E))),
          s && (f = new RegExp('^' + _ + '$(?!\\s)', E)),
          i && (d = h.lastIndex),
          (p = e.call(y ? f : h, b)),
          y
            ? p
              ? ((p.input = p.input.slice(g)),
                (p[0] = p[0].slice(g)),
                (p.index = h.lastIndex),
                (h.lastIndex += p[0].length))
              : (h.lastIndex = 0)
            : i && p && (h.lastIndex = h.global ? p.index + p[0].length : d),
          s &&
            p &&
            p.length > 1 &&
            n.call(p[0], f, function () {
              for (v = 1; v < arguments.length - 2; v++) arguments[v] === void 0 && (p[v] = void 0);
            }),
          p
        );
      }),
    (Ro = a),
    Ro
  );
}
var hh;
function _m() {
  if (hh) return uh;
  hh = 1;
  var r = ge(),
    t = ou();
  return r({ target: 'RegExp', proto: !0, forced: /./.exec !== t }, { exec: t }), uh;
}
_m();
var dh = {},
  ph;
function Gg() {
  if (ph) return dh;
  ph = 1;
  var r = Ye(),
    t = ur(),
    e = iu(),
    n = bm().UNSUPPORTED_Y;
  return r && (/./g.flags != 'g' || n) && t.f(RegExp.prototype, 'flags', { configurable: !0, get: e }), dh;
}
Gg();
var vh = {},
  mh;
function Vg() {
  if (mh) return vh;
  mh = 1;
  var r = Er(),
    t = sr(),
    e = Ee(),
    n = iu(),
    a = 'toString',
    i = RegExp.prototype,
    o = i[a],
    s = e(function () {
      return o.call({ source: 'a', flags: 'b' }) != '/a/b';
    }),
    u = o.name != a;
  return (
    (s || u) &&
      r(
        RegExp.prototype,
        a,
        function () {
          var c = t(this),
            h = String(c.source),
            d = c.flags,
            f = String(d === void 0 && c instanceof RegExp && !('flags' in i) ? n.call(c) : d);
          return '/' + h + '/' + f;
        },
        { unsafe: !0 }
      ),
    vh
  );
}
Vg();
var yh = {},
  To,
  gh;
function $g() {
  if (gh) return To;
  gh = 1;
  var r = Je(),
    t = Gr(),
    e = Pe(),
    n = e('match');
  return (
    (To = function (a) {
      var i;
      return r(a) && ((i = a[n]) !== void 0 ? !!i : t(a) == 'RegExp');
    }),
    To
  );
}
var xo, bh;
function wm() {
  if (bh) return xo;
  bh = 1;
  var r = $g();
  return (
    (xo = function (t) {
      if (r(t)) throw TypeError("The method doesn't accept regular expressions");
      return t;
    }),
    xo
  );
}
var Po, _h;
function Sm() {
  if (_h) return Po;
  _h = 1;
  var r = Pe(),
    t = r('match');
  return (
    (Po = function (e) {
      var n = /./;
      try {
        '/./'[e](n);
      } catch {
        try {
          return (n[t] = !1), '/./'[e](n);
        } catch {}
      }
      return !1;
    }),
    Po
  );
}
var wh;
function Kg() {
  if (wh) return yh;
  wh = 1;
  var r = ge(),
    t = wm(),
    e = ht(),
    n = Sm();
  return (
    r(
      { target: 'String', proto: !0, forced: !n('includes') },
      {
        includes: function (i) {
          return !!~String(e(this)).indexOf(t(i), arguments.length > 1 ? arguments[1] : void 0);
        },
      }
    ),
    yh
  );
}
Kg();
var Sh = {},
  Io,
  kh;
function su() {
  if (kh) return Io;
  kh = 1;
  var r = jr(),
    t = ht(),
    e = function (n) {
      return function (a, i) {
        var o = String(t(a)),
          s = r(i),
          u = o.length,
          l,
          c;
        return s < 0 || s >= u
          ? n
            ? ''
            : void 0
          : ((l = o.charCodeAt(s)),
            l < 55296 || l > 56319 || s + 1 === u || (c = o.charCodeAt(s + 1)) < 56320 || c > 57343
              ? n
                ? o.charAt(s)
                : l
              : n
              ? o.slice(s, s + 2)
              : ((l - 55296) << 10) + (c - 56320) + 65536);
      };
    };
  return (Io = { codeAt: e(!1), charAt: e(!0) }), Io;
}
var Eh;
function km() {
  if (Eh) return Sh;
  Eh = 1;
  var r = su().charAt,
    t = Jr(),
    e = im(),
    n = 'String Iterator',
    a = t.set,
    i = t.getterFor(n);
  return (
    e(
      String,
      'String',
      function (o) {
        a(this, { type: n, string: String(o), index: 0 });
      },
      function () {
        var s = i(this),
          u = s.string,
          l = s.index,
          c;
        return l >= u.length
          ? { value: void 0, done: !0 }
          : ((c = r(u, l)), (s.index += c.length), { value: c, done: !1 });
      }
    ),
    Sh
  );
}
km();
var Ah = {},
  Co,
  Rh;
function Zg() {
  if (Rh) return Co;
  (Rh = 1), _m();
  var r = Er(),
    t = Ee(),
    e = Pe(),
    n = ou(),
    a = gr(),
    i = e('species'),
    o = !t(function () {
      var h = /./;
      return (
        (h.exec = function () {
          var d = [];
          return (d.groups = { a: '7' }), d;
        }),
        ''.replace(h, '$<a>') !== '7'
      );
    }),
    s = (function () {
      return 'a'.replace(/./, '$0') === '$0';
    })(),
    u = e('replace'),
    l = (function () {
      return /./[u] ? /./[u]('a', '$0') === '' : !1;
    })(),
    c = !t(function () {
      var h = /(?:)/,
        d = h.exec;
      h.exec = function () {
        return d.apply(this, arguments);
      };
      var f = 'ab'.split(h);
      return f.length !== 2 || f[0] !== 'a' || f[1] !== 'b';
    });
  return (
    (Co = function (h, d, f, p) {
      var v = e(h),
        y = !t(function () {
          var w = {};
          return (
            (w[v] = function () {
              return 7;
            }),
            ''[h](w) != 7
          );
        }),
        E =
          y &&
          !t(function () {
            var w = !1,
              T = /a/;
            return (
              h === 'split' &&
                ((T = {}),
                (T.constructor = {}),
                (T.constructor[i] = function () {
                  return T;
                }),
                (T.flags = ''),
                (T[v] = /./[v])),
              (T.exec = function () {
                return (w = !0), null;
              }),
              T[v](''),
              !w
            );
          });
      if (!y || !E || (h === 'replace' && !(o && s && !l)) || (h === 'split' && !c)) {
        var _ = /./[v],
          g = f(
            v,
            ''[h],
            function (w, T, P, x, C) {
              return T.exec === n
                ? y && !C
                  ? { done: !0, value: _.call(T, P, x) }
                  : { done: !0, value: w.call(P, T, x) }
                : { done: !1 };
            },
            { REPLACE_KEEPS_$0: s, REGEXP_REPLACE_SUBSTITUTES_UNDEFINED_CAPTURE: l }
          ),
          b = g[0],
          A = g[1];
        r(String.prototype, h, b),
          r(
            RegExp.prototype,
            v,
            d == 2
              ? function (w, T) {
                  return A.call(w, this, T);
                }
              : function (w) {
                  return A.call(w, this);
                }
          );
      }
      p && a(RegExp.prototype[v], 'sham', !0);
    }),
    Co
  );
}
var Oo, Th;
function Xg() {
  if (Th) return Oo;
  Th = 1;
  var r = su().charAt;
  return (
    (Oo = function (t, e, n) {
      return e + (n ? r(t, e).length : 1);
    }),
    Oo
  );
}
var No, xh;
function Yg() {
  if (xh) return No;
  xh = 1;
  var r = Gr(),
    t = ou();
  return (
    (No = function (e, n) {
      var a = e.exec;
      if (typeof a == 'function') {
        var i = a.call(e, n);
        if (typeof i != 'object') throw TypeError('RegExp exec method returned something other than an Object or null');
        return i;
      }
      if (r(e) !== 'RegExp') throw TypeError('RegExp#exec called on incompatible receiver');
      return t.call(e, n);
    }),
    No
  );
}
var Ph;
function Jg() {
  if (Ph) return Ah;
  Ph = 1;
  var r = Zg(),
    t = sr(),
    e = lr(),
    n = Ke(),
    a = jr(),
    i = ht(),
    o = Xg(),
    s = Yg(),
    u = Math.max,
    l = Math.min,
    c = Math.floor,
    h = /\$([$&'`]|\d\d?|<[^>]*>)/g,
    d = /\$([$&'`]|\d\d?)/g,
    f = function (p) {
      return p === void 0 ? p : String(p);
    };
  return (
    r('replace', 2, function (p, v, y, E) {
      var _ = E.REGEXP_REPLACE_SUBSTITUTES_UNDEFINED_CAPTURE,
        g = E.REPLACE_KEEPS_$0,
        b = _ ? '$' : '$0';
      return [
        function (T, P) {
          var x = i(this),
            C = T?.[p];
          return C !== void 0 ? C.call(T, x, P) : v.call(String(x), T, P);
        },
        function (w, T) {
          if ((!_ && g) || (typeof T == 'string' && T.indexOf(b) === -1)) {
            var P = y(v, w, this, T);
            if (P.done) return P.value;
          }
          var x = t(w),
            C = String(this),
            q = typeof T == 'function';
          q || (T = String(T));
          var L = x.global;
          if (L) {
            var ae = x.unicode;
            x.lastIndex = 0;
          }
          for (var te = []; ; ) {
            var k = s(x, C);
            if (k === null || (te.push(k), !L)) break;
            var m = String(k[0]);
            m === '' && (x.lastIndex = o(C, n(x.lastIndex), ae));
          }
          for (var R = '', I = 0, M = 0; M < te.length; M++) {
            k = te[M];
            for (var U = String(k[0]), N = u(l(a(k.index), C.length), 0), Z = [], ne = 1; ne < k.length; ne++)
              Z.push(f(k[ne]));
            var oe = k.groups;
            if (q) {
              var fe = [U].concat(Z, N, C);
              oe !== void 0 && fe.push(oe);
              var Y = String(T.apply(void 0, fe));
            } else Y = A(U, C, N, Z, oe, T);
            N >= I && ((R += C.slice(I, N) + Y), (I = N + U.length));
          }
          return R + C.slice(I);
        },
      ];
      function A(w, T, P, x, C, q) {
        var L = P + w.length,
          ae = x.length,
          te = d;
        return (
          C !== void 0 && ((C = e(C)), (te = h)),
          v.call(q, te, function (k, m) {
            var R;
            switch (m.charAt(0)) {
              case '$':
                return '$';
              case '&':
                return w;
              case '`':
                return T.slice(0, P);
              case "'":
                return T.slice(L);
              case '<':
                R = C[m.slice(1, -1)];
                break;
              default:
                var I = +m;
                if (I === 0) return k;
                if (I > ae) {
                  var M = c(I / 10);
                  return M === 0 ? k : M <= ae ? (x[M - 1] === void 0 ? m.charAt(1) : x[M - 1] + m.charAt(1)) : k;
                }
                R = x[I - 1];
            }
            return R === void 0 ? '' : R;
          })
        );
      }
    }),
    Ah
  );
}
Jg();
var Ih = {},
  Ch;
function Qg() {
  if (Ch) return Ih;
  Ch = 1;
  var r = ge(),
    t = Yr().f,
    e = Ke(),
    n = wm(),
    a = ht(),
    i = Sm(),
    o = dt(),
    s = ''.startsWith,
    u = Math.min,
    l = i('startsWith'),
    c =
      !o &&
      !l &&
      !!(function () {
        var h = t(String.prototype, 'startsWith');
        return h && !h.writable;
      })();
  return (
    r(
      { target: 'String', proto: !0, forced: !c && !l },
      {
        startsWith: function (d) {
          var f = String(a(this));
          n(d);
          var p = e(u(arguments.length > 1 ? arguments[1] : void 0, f.length)),
            v = String(d);
          return s ? s.call(f, v, p) : f.slice(p, p + v.length) === v;
        },
      }
    ),
    Ih
  );
}
Qg();
var Oh = {},
  Mo,
  Nh;
function eb() {
  if (Nh) return Mo;
  Nh = 1;
  var r = Ee(),
    t = cm(),
    e = '​᠎';
  return (
    (Mo = function (n) {
      return r(function () {
        return !!t[n]() || e[n]() != e || t[n].name !== n;
      });
    }),
    Mo
  );
}
var Mh;
function rb() {
  if (Mh) return Oh;
  Mh = 1;
  var r = ge(),
    t = fm().trim,
    e = eb();
  return (
    r(
      { target: 'String', proto: !0, forced: e('trim') },
      {
        trim: function () {
          return t(this);
        },
      }
    ),
    Oh
  );
}
rb();
var Fh = {},
  Nn = { exports: {} },
  Fo,
  qh;
function Ce() {
  if (qh) return Fo;
  qh = 1;
  var r = om(),
    t = Ye(),
    e = Re(),
    n = Je(),
    a = ar(),
    i = En(),
    o = gr(),
    s = Er(),
    u = ur().f,
    l = Vt(),
    c = Rn(),
    h = Pe(),
    d = ia(),
    f = e.Int8Array,
    p = f && f.prototype,
    v = e.Uint8ClampedArray,
    y = v && v.prototype,
    E = f && l(f),
    _ = p && l(p),
    g = Object.prototype,
    b = g.isPrototypeOf,
    A = h('toStringTag'),
    w = d('TYPED_ARRAY_TAG'),
    T = r && !!c && i(e.opera) !== 'Opera',
    P = !1,
    x,
    C = {
      Int8Array: 1,
      Uint8Array: 1,
      Uint8ClampedArray: 1,
      Int16Array: 2,
      Uint16Array: 2,
      Int32Array: 4,
      Uint32Array: 4,
      Float32Array: 4,
      Float64Array: 8,
    },
    q = function (I) {
      var M = i(I);
      return M === 'DataView' || a(C, M);
    },
    L = function (R) {
      return n(R) && a(C, i(R));
    },
    ae = function (R) {
      if (L(R)) return R;
      throw TypeError('Target is not a typed array');
    },
    te = function (R) {
      if (c) {
        if (b.call(E, R)) return R;
      } else
        for (var I in C)
          if (a(C, x)) {
            var M = e[I];
            if (M && (R === M || b.call(M, R))) return R;
          }
      throw TypeError('Target is not a typed array constructor');
    },
    k = function (R, I, M) {
      if (t) {
        if (M)
          for (var U in C) {
            var N = e[U];
            N && a(N.prototype, R) && delete N.prototype[R];
          }
        (!_[R] || M) && s(_, R, M ? I : (T && p[R]) || I);
      }
    },
    m = function (R, I, M) {
      var U, N;
      if (t) {
        if (c) {
          if (M) for (U in C) (N = e[U]), N && a(N, R) && delete N[R];
          if (!E[R] || M)
            try {
              return s(E, R, M ? I : (T && f[R]) || I);
            } catch {}
          else return;
        }
        for (U in C) (N = e[U]), N && (!N[R] || M) && s(N, R, I);
      }
    };
  for (x in C) e[x] || (T = !1);
  if (
    (!T || typeof E != 'function' || E === Function.prototype) &&
    ((E = function () {
      throw TypeError('Incorrect invocation');
    }),
    T)
  )
    for (x in C) e[x] && c(e[x], E);
  if ((!T || !_ || _ === g) && ((_ = E.prototype), T)) for (x in C) e[x] && c(e[x].prototype, _);
  if ((T && l(y) !== _ && c(y, _), t && !a(_, A))) {
    (P = !0),
      u(_, A, {
        get: function () {
          return n(this) ? this[w] : void 0;
        },
      });
    for (x in C) e[x] && o(e[x], w, x);
  }
  return (
    (Fo = {
      NATIVE_ARRAY_BUFFER_VIEWS: T,
      TYPED_ARRAY_TAG: P && w,
      aTypedArray: ae,
      aTypedArrayConstructor: te,
      exportTypedArrayMethod: k,
      exportTypedArrayStaticMethod: m,
      isView: q,
      isTypedArray: L,
      TypedArray: E,
      TypedArrayPrototype: _,
    }),
    Fo
  );
}
var qo, Bh;
function Em() {
  if (Bh) return qo;
  Bh = 1;
  var r = Re(),
    t = Ee(),
    e = ru(),
    n = Ce().NATIVE_ARRAY_BUFFER_VIEWS,
    a = r.ArrayBuffer,
    i = r.Int8Array;
  return (
    (qo =
      !n ||
      !t(function () {
        i(1);
      }) ||
      !t(function () {
        new i(-1);
      }) ||
      !e(function (o) {
        new i(), new i(null), new i(1.5), new i(o);
      }, !0) ||
      t(function () {
        return new i(new a(2), 1, void 0).length !== 1;
      })),
    qo
  );
}
var Bo, Dh;
function tb() {
  if (Dh) return Bo;
  Dh = 1;
  var r = jr();
  return (
    (Bo = function (t) {
      var e = r(t);
      if (e < 0) throw RangeError("The argument can't be less than 0");
      return e;
    }),
    Bo
  );
}
var Do, jh;
function Am() {
  if (jh) return Do;
  jh = 1;
  var r = tb();
  return (
    (Do = function (t, e) {
      var n = r(t);
      if (n % e) throw RangeError('Wrong offset');
      return n;
    }),
    Do
  );
}
var jo, Lh;
function Rm() {
  if (Lh) return jo;
  Lh = 1;
  var r = lr(),
    t = Ke(),
    e = An(),
    n = Qs(),
    a = Pt(),
    i = Ce().aTypedArrayConstructor;
  return (
    (jo = function (s) {
      var u = r(s),
        l = arguments.length,
        c = l > 1 ? arguments[1] : void 0,
        h = c !== void 0,
        d = e(u),
        f,
        p,
        v,
        y,
        E,
        _;
      if (d != null && !n(d)) for (E = d.call(u), _ = E.next, u = []; !(y = _.call(E)).done; ) u.push(y.value);
      for (h && l > 2 && (c = a(c, arguments[2], 2)), p = t(u.length), v = new (i(this))(p), f = 0; p > f; f++)
        v[f] = h ? c(u[f], f) : u[f];
      return v;
    }),
    jo
  );
}
var Uh;
function ha() {
  if (Uh) return Nn.exports;
  Uh = 1;
  var r = ge(),
    t = Re(),
    e = Ye(),
    n = Em(),
    a = Ce(),
    i = um(),
    o = Tn(),
    s = Rt(),
    u = gr(),
    l = Ke(),
    c = sm(),
    h = Am(),
    d = Tt(),
    f = ar(),
    p = En(),
    v = Je(),
    y = xt(),
    E = Rn(),
    _ = Wt().f,
    g = Rm(),
    b = br().forEach,
    A = nu(),
    w = ur(),
    T = Yr(),
    P = Jr(),
    x = lm(),
    C = P.get,
    q = P.set,
    L = w.f,
    ae = T.f,
    te = Math.round,
    k = t.RangeError,
    m = i.ArrayBuffer,
    R = i.DataView,
    I = a.NATIVE_ARRAY_BUFFER_VIEWS,
    M = a.TYPED_ARRAY_TAG,
    U = a.TypedArray,
    N = a.TypedArrayPrototype,
    Z = a.aTypedArrayConstructor,
    ne = a.isTypedArray,
    oe = 'BYTES_PER_ELEMENT',
    fe = 'Wrong length',
    Y = function (K, D) {
      for (var ee = 0, he = D.length, we = new (Z(K))(he); he > ee; ) we[ee] = D[ee++];
      return we;
    },
    z = function (K, D) {
      L(K, D, {
        get: function () {
          return C(this)[D];
        },
      });
    },
    Q = function (K) {
      var D;
      return K instanceof m || (D = p(K)) == 'ArrayBuffer' || D == 'SharedArrayBuffer';
    },
    ue = function (K, D) {
      return ne(K) && typeof D != 'symbol' && D in K && String(+D) == String(D);
    },
    G = function (D, ee) {
      return ue(D, (ee = d(ee, !0))) ? s(2, D[ee]) : ae(D, ee);
    },
    ie = function (D, ee, he) {
      return ue(D, (ee = d(ee, !0))) &&
        v(he) &&
        f(he, 'value') &&
        !f(he, 'get') &&
        !f(he, 'set') &&
        !he.configurable &&
        (!f(he, 'writable') || he.writable) &&
        (!f(he, 'enumerable') || he.enumerable)
        ? ((D[ee] = he.value), D)
        : L(D, ee, he);
    };
  return (
    e
      ? (I || ((T.f = G), (w.f = ie), z(N, 'buffer'), z(N, 'byteOffset'), z(N, 'byteLength'), z(N, 'length')),
        r({ target: 'Object', stat: !0, forced: !I }, { getOwnPropertyDescriptor: G, defineProperty: ie }),
        (Nn.exports = function (K, D, ee) {
          var he = K.match(/\d+$/)[0] / 8,
            we = K + (ee ? 'Clamped' : '') + 'Array',
            De = 'get' + K,
            He = 'set' + K,
            Fe = t[we],
            Se = Fe,
            Qe = Se && Se.prototype,
            dr = {},
            rr = function (Te, X) {
              var $ = C(Te);
              return $.view[De](X * he + $.byteOffset, !0);
            },
            pr = function (Te, X, $) {
              var ce = C(Te);
              ee && ($ = ($ = te($)) < 0 ? 0 : $ > 255 ? 255 : $ & 255), ce.view[He](X * he + ce.byteOffset, $, !0);
            },
            _r = function (Te, X) {
              L(Te, X, {
                get: function () {
                  return rr(this, X);
                },
                set: function ($) {
                  return pr(this, X, $);
                },
                enumerable: !0,
              });
            };
          I
            ? n &&
              ((Se = D(function (Te, X, $, ce) {
                return (
                  o(Te, Se, we),
                  x(
                    (function () {
                      return v(X)
                        ? Q(X)
                          ? ce !== void 0
                            ? new Fe(X, h($, he), ce)
                            : $ !== void 0
                            ? new Fe(X, h($, he))
                            : new Fe(X)
                          : ne(X)
                          ? Y(Se, X)
                          : g.call(Se, X)
                        : new Fe(c(X));
                    })(),
                    Te,
                    Se
                  )
                );
              })),
              E && E(Se, U),
              b(_(Fe), function (Te) {
                Te in Se || u(Se, Te, Fe[Te]);
              }),
              (Se.prototype = Qe))
            : ((Se = D(function (Te, X, $, ce) {
                o(Te, Se, we);
                var ve = 0,
                  re = 0,
                  J,
                  se,
                  de;
                if (!v(X)) (de = c(X)), (se = de * he), (J = new m(se));
                else if (Q(X)) {
                  (J = X), (re = h($, he));
                  var me = X.byteLength;
                  if (ce === void 0) {
                    if (me % he || ((se = me - re), se < 0)) throw k(fe);
                  } else if (((se = l(ce) * he), se + re > me)) throw k(fe);
                  de = se / he;
                } else return ne(X) ? Y(Se, X) : g.call(Se, X);
                for (q(Te, { buffer: J, byteOffset: re, byteLength: se, length: de, view: new R(J) }); ve < de; )
                  _r(Te, ve++);
              })),
              E && E(Se, U),
              (Qe = Se.prototype = y(N))),
            Qe.constructor !== Se && u(Qe, 'constructor', Se),
            M && u(Qe, M, we),
            (dr[we] = Se),
            r({ global: !0, forced: Se != Fe, sham: !I }, dr),
            oe in Se || u(Se, oe, he),
            oe in Qe || u(Qe, oe, he),
            A(we);
        }))
      : (Nn.exports = function () {}),
    Nn.exports
  );
}
var zh;
function nb() {
  if (zh) return Fh;
  zh = 1;
  var r = ha();
  return (
    r('Int32', function (t) {
      return function (n, a, i) {
        return t(this, n, a, i);
      };
    }),
    Fh
  );
}
nb();
var Wh = {},
  Hh;
function ab() {
  if (Hh) return Wh;
  Hh = 1;
  var r = ha();
  return (
    r('Uint8', function (t) {
      return function (n, a, i) {
        return t(this, n, a, i);
      };
    }),
    Wh
  );
}
ab();
var Gh = {},
  Vh;
function ib() {
  if (Vh) return Gh;
  Vh = 1;
  var r = ha();
  return (
    r('Uint16', function (t) {
      return function (n, a, i) {
        return t(this, n, a, i);
      };
    }),
    Gh
  );
}
ib();
var $h = {},
  Kh;
function ob() {
  if (Kh) return $h;
  Kh = 1;
  var r = ha();
  return (
    r('Uint32', function (t) {
      return function (n, a, i) {
        return t(this, n, a, i);
      };
    }),
    $h
  );
}
ob();
var Zh = {},
  Lo,
  Xh;
function sb() {
  if (Xh) return Lo;
  Xh = 1;
  var r = lr(),
    t = zt(),
    e = Ke(),
    n = Math.min;
  return (
    (Lo =
      [].copyWithin ||
      function (i, o) {
        var s = r(this),
          u = e(s.length),
          l = t(i, u),
          c = t(o, u),
          h = arguments.length > 2 ? arguments[2] : void 0,
          d = n((h === void 0 ? u : t(h, u)) - c, u - l),
          f = 1;
        for (c < l && l < c + d && ((f = -1), (c += d - 1), (l += d - 1)); d-- > 0; )
          c in s ? (s[l] = s[c]) : delete s[l], (l += f), (c += f);
        return s;
      }),
    Lo
  );
}
var Yh;
function ub() {
  if (Yh) return Zh;
  Yh = 1;
  var r = Ce(),
    t = sb(),
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('copyWithin', function (i, o) {
      return t.call(e(this), i, o, arguments.length > 2 ? arguments[2] : void 0);
    }),
    Zh
  );
}
ub();
var Jh = {},
  Qh;
function lb() {
  if (Qh) return Jh;
  Qh = 1;
  var r = Ce(),
    t = br().every,
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('every', function (i) {
      return t(e(this), i, arguments.length > 1 ? arguments[1] : void 0);
    }),
    Jh
  );
}
lb();
var ed = {},
  rd;
function cb() {
  if (rd) return ed;
  rd = 1;
  var r = Ce(),
    t = Js(),
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('fill', function (i) {
      return t.apply(e(this), arguments);
    }),
    ed
  );
}
cb();
var td = {},
  nd;
function fb() {
  if (nd) return td;
  nd = 1;
  var r = Ce(),
    t = br().filter,
    e = $t(),
    n = r.aTypedArray,
    a = r.aTypedArrayConstructor,
    i = r.exportTypedArrayMethod;
  return (
    i('filter', function (s) {
      for (
        var u = t(n(this), s, arguments.length > 1 ? arguments[1] : void 0),
          l = e(this, this.constructor),
          c = 0,
          h = u.length,
          d = new (a(l))(h);
        h > c;

      )
        d[c] = u[c++];
      return d;
    }),
    td
  );
}
fb();
var ad = {},
  id;
function hb() {
  if (id) return ad;
  id = 1;
  var r = Ce(),
    t = br().find,
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('find', function (i) {
      return t(e(this), i, arguments.length > 1 ? arguments[1] : void 0);
    }),
    ad
  );
}
hb();
var od = {},
  sd;
function db() {
  if (sd) return od;
  sd = 1;
  var r = Ce(),
    t = br().findIndex,
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('findIndex', function (i) {
      return t(e(this), i, arguments.length > 1 ? arguments[1] : void 0);
    }),
    od
  );
}
db();
var ud = {},
  ld;
function pb() {
  if (ld) return ud;
  ld = 1;
  var r = Ce(),
    t = br().forEach,
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('forEach', function (i) {
      t(e(this), i, arguments.length > 1 ? arguments[1] : void 0);
    }),
    ud
  );
}
pb();
var cd = {},
  fd;
function vb() {
  if (fd) return cd;
  fd = 1;
  var r = Em(),
    t = Ce().exportTypedArrayStaticMethod,
    e = Rm();
  return t('from', e, r), cd;
}
vb();
var hd = {},
  dd;
function mb() {
  if (dd) return hd;
  dd = 1;
  var r = Ce(),
    t = ua().includes,
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('includes', function (i) {
      return t(e(this), i, arguments.length > 1 ? arguments[1] : void 0);
    }),
    hd
  );
}
mb();
var pd = {},
  vd;
function yb() {
  if (vd) return pd;
  vd = 1;
  var r = Ce(),
    t = ua().indexOf,
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('indexOf', function (i) {
      return t(e(this), i, arguments.length > 1 ? arguments[1] : void 0);
    }),
    pd
  );
}
yb();
var md = {},
  yd;
function gb() {
  if (yd) return md;
  yd = 1;
  var r = Re(),
    t = Ce(),
    e = ca(),
    n = Pe(),
    a = n('iterator'),
    i = r.Uint8Array,
    o = e.values,
    s = e.keys,
    u = e.entries,
    l = t.aTypedArray,
    c = t.exportTypedArrayMethod,
    h = i && i.prototype[a],
    d = !!h && (h.name == 'values' || h.name == null),
    f = function () {
      return o.call(l(this));
    };
  return (
    c('entries', function () {
      return u.call(l(this));
    }),
    c('keys', function () {
      return s.call(l(this));
    }),
    c('values', f, !d),
    c(a, f, !d),
    md
  );
}
gb();
var gd = {},
  bd;
function bb() {
  if (bd) return gd;
  bd = 1;
  var r = Ce(),
    t = r.aTypedArray,
    e = r.exportTypedArrayMethod,
    n = [].join;
  return (
    e('join', function (i) {
      return n.apply(t(this), arguments);
    }),
    gd
  );
}
bb();
var _d = {},
  Uo,
  wd;
function _b() {
  if (wd) return Uo;
  wd = 1;
  var r = Or(),
    t = jr(),
    e = Ke(),
    n = fa(),
    a = rt(),
    i = Math.min,
    o = [].lastIndexOf,
    s = !!o && 1 / [1].lastIndexOf(1, -0) < 0,
    u = n('lastIndexOf'),
    l = a('indexOf', { ACCESSORS: !0, 1: 0 }),
    c = s || !u || !l;
  return (
    (Uo = c
      ? function (d) {
          if (s) return o.apply(this, arguments) || 0;
          var f = r(this),
            p = e(f.length),
            v = p - 1;
          for (arguments.length > 1 && (v = i(v, t(arguments[1]))), v < 0 && (v = p + v); v >= 0; v--)
            if (v in f && f[v] === d) return v || 0;
          return -1;
        }
      : o),
    Uo
  );
}
var Sd;
function wb() {
  if (Sd) return _d;
  Sd = 1;
  var r = Ce(),
    t = _b(),
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('lastIndexOf', function (i) {
      return t.apply(e(this), arguments);
    }),
    _d
  );
}
wb();
var kd = {},
  Ed;
function Sb() {
  if (Ed) return kd;
  Ed = 1;
  var r = Ce(),
    t = br().map,
    e = $t(),
    n = r.aTypedArray,
    a = r.aTypedArrayConstructor,
    i = r.exportTypedArrayMethod;
  return (
    i('map', function (s) {
      return t(n(this), s, arguments.length > 1 ? arguments[1] : void 0, function (u, l) {
        return new (a(e(u, u.constructor)))(l);
      });
    }),
    kd
  );
}
Sb();
var Ad = {},
  zo,
  Rd;
function Tm() {
  if (Rd) return zo;
  Rd = 1;
  var r = Vr(),
    t = lr(),
    e = gn(),
    n = Ke(),
    a = function (i) {
      return function (o, s, u, l) {
        r(s);
        var c = t(o),
          h = e(c),
          d = n(c.length),
          f = i ? d - 1 : 0,
          p = i ? -1 : 1;
        if (u < 2)
          for (;;) {
            if (f in h) {
              (l = h[f]), (f += p);
              break;
            }
            if (((f += p), i ? f < 0 : d <= f)) throw TypeError('Reduce of empty array with no initial value');
          }
        for (; i ? f >= 0 : d > f; f += p) f in h && (l = s(l, h[f], f, c));
        return l;
      };
    };
  return (zo = { left: a(!1), right: a(!0) }), zo;
}
var Td;
function kb() {
  if (Td) return Ad;
  Td = 1;
  var r = Ce(),
    t = Tm().left,
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('reduce', function (i) {
      return t(e(this), i, arguments.length, arguments.length > 1 ? arguments[1] : void 0);
    }),
    Ad
  );
}
kb();
var xd = {},
  Pd;
function Eb() {
  if (Pd) return xd;
  Pd = 1;
  var r = Ce(),
    t = Tm().right,
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('reduceRight', function (i) {
      return t(e(this), i, arguments.length, arguments.length > 1 ? arguments[1] : void 0);
    }),
    xd
  );
}
Eb();
var Id = {},
  Cd;
function Ab() {
  if (Cd) return Id;
  Cd = 1;
  var r = Ce(),
    t = r.aTypedArray,
    e = r.exportTypedArrayMethod,
    n = Math.floor;
  return (
    e('reverse', function () {
      for (var i = this, o = t(i).length, s = n(o / 2), u = 0, l; u < s; ) (l = i[u]), (i[u++] = i[--o]), (i[o] = l);
      return i;
    }),
    Id
  );
}
Ab();
var Od = {},
  Nd;
function Rb() {
  if (Nd) return Od;
  Nd = 1;
  var r = Ce(),
    t = Ke(),
    e = Am(),
    n = lr(),
    a = Ee(),
    i = r.aTypedArray,
    o = r.exportTypedArrayMethod,
    s = a(function () {
      new Int8Array(1).set({});
    });
  return (
    o(
      'set',
      function (l) {
        i(this);
        var c = e(arguments.length > 1 ? arguments[1] : void 0, 1),
          h = this.length,
          d = n(l),
          f = t(d.length),
          p = 0;
        if (f + c > h) throw RangeError('Wrong length');
        for (; p < f; ) this[c + p] = d[p++];
      },
      s
    ),
    Od
  );
}
Rb();
var Md = {},
  Fd;
function Tb() {
  if (Fd) return Md;
  Fd = 1;
  var r = Ce(),
    t = $t(),
    e = Ee(),
    n = r.aTypedArray,
    a = r.aTypedArrayConstructor,
    i = r.exportTypedArrayMethod,
    o = [].slice,
    s = e(function () {
      new Int8Array(1).slice();
    });
  return (
    i(
      'slice',
      function (l, c) {
        for (
          var h = o.call(n(this), l, c), d = t(this, this.constructor), f = 0, p = h.length, v = new (a(d))(p);
          p > f;

        )
          v[f] = h[f++];
        return v;
      },
      s
    ),
    Md
  );
}
Tb();
var qd = {},
  Bd;
function xb() {
  if (Bd) return qd;
  Bd = 1;
  var r = Ce(),
    t = br().some,
    e = r.aTypedArray,
    n = r.exportTypedArrayMethod;
  return (
    n('some', function (i) {
      return t(e(this), i, arguments.length > 1 ? arguments[1] : void 0);
    }),
    qd
  );
}
xb();
var Dd = {},
  jd;
function Pb() {
  if (jd) return Dd;
  jd = 1;
  var r = Ce(),
    t = r.aTypedArray,
    e = r.exportTypedArrayMethod,
    n = [].sort;
  return (
    e('sort', function (i) {
      return n.call(t(this), i);
    }),
    Dd
  );
}
Pb();
var Ld = {},
  Ud;
function Ib() {
  if (Ud) return Ld;
  Ud = 1;
  var r = Ce(),
    t = Ke(),
    e = zt(),
    n = $t(),
    a = r.aTypedArray,
    i = r.exportTypedArrayMethod;
  return (
    i('subarray', function (s, u) {
      var l = a(this),
        c = l.length,
        h = e(s, c);
      return new (n(l, l.constructor))(
        l.buffer,
        l.byteOffset + h * l.BYTES_PER_ELEMENT,
        t((u === void 0 ? c : e(u, c)) - h)
      );
    }),
    Ld
  );
}
Ib();
var zd = {},
  Wd;
function Cb() {
  if (Wd) return zd;
  Wd = 1;
  var r = Re(),
    t = Ce(),
    e = Ee(),
    n = r.Int8Array,
    a = t.aTypedArray,
    i = t.exportTypedArrayMethod,
    o = [].toLocaleString,
    s = [].slice,
    u =
      !!n &&
      e(function () {
        o.call(new n(1));
      }),
    l =
      e(function () {
        return [1, 2].toLocaleString() != new n([1, 2]).toLocaleString();
      }) ||
      !e(function () {
        n.prototype.toLocaleString.call([1, 2]);
      });
  return (
    i(
      'toLocaleString',
      function () {
        return o.apply(u ? s.call(a(this)) : a(this), arguments);
      },
      l
    ),
    zd
  );
}
Cb();
var Hd = {},
  Gd;
function Ob() {
  if (Gd) return Hd;
  Gd = 1;
  var r = Ce().exportTypedArrayMethod,
    t = Ee(),
    e = Re(),
    n = e.Uint8Array,
    a = (n && n.prototype) || {},
    i = [].toString,
    o = [].join;
  t(function () {
    i.call({});
  }) &&
    (i = function () {
      return o.call(this);
    });
  var s = a.toString != i;
  return r('toString', i, s), Hd;
}
Ob();
var Vd = {},
  $d = {},
  Kd;
function Nb() {
  if (Kd) return $d;
  Kd = 1;
  var r = ge(),
    t = Re();
  return r({ global: !0 }, { globalThis: t }), $d;
}
var Zd;
function Mb() {
  return Zd || ((Zd = 1), Nb()), Vd;
}
Mb();
var Xd = {},
  Yd = {},
  Jd;
function Fb() {
  if (Jd) return Yd;
  Jd = 1;
  var r = ge(),
    t = Vr(),
    e = au(),
    n = gm(),
    a = pm();
  return (
    r(
      { target: 'Promise', stat: !0 },
      {
        allSettled: function (o) {
          var s = this,
            u = e.f(s),
            l = u.resolve,
            c = u.reject,
            h = n(function () {
              var d = t(s.resolve),
                f = [],
                p = 0,
                v = 1;
              a(o, function (y) {
                var E = p++,
                  _ = !1;
                f.push(void 0),
                  v++,
                  d.call(s, y).then(
                    function (g) {
                      _ || ((_ = !0), (f[E] = { status: 'fulfilled', value: g }), --v || l(f));
                    },
                    function (g) {
                      _ || ((_ = !0), (f[E] = { status: 'rejected', reason: g }), --v || l(f));
                    }
                  );
              }),
                --v || l(f);
            });
          return h.error && c(h.value), u.promise;
        },
      }
    ),
    Yd
  );
}
var Qd;
function qb() {
  return Qd || ((Qd = 1), Fb()), Xd;
}
qb();
var ep = {},
  Wo,
  rp;
function xm() {
  return (
    rp ||
      ((rp = 1),
      (Wo = {
        CSSRuleList: 0,
        CSSStyleDeclaration: 0,
        CSSValueList: 0,
        ClientRectList: 0,
        DOMRectList: 0,
        DOMStringList: 0,
        DOMTokenList: 1,
        DataTransferItemList: 0,
        FileList: 0,
        HTMLAllCollection: 0,
        HTMLCollection: 0,
        HTMLFormElement: 0,
        HTMLSelectElement: 0,
        MediaList: 0,
        MimeTypeArray: 0,
        NamedNodeMap: 0,
        NodeList: 1,
        PaintRequestList: 0,
        Plugin: 0,
        PluginArray: 0,
        SVGLengthList: 0,
        SVGNumberList: 0,
        SVGPathSegList: 0,
        SVGPointList: 0,
        SVGStringList: 0,
        SVGTransformList: 0,
        SourceBufferList: 0,
        StyleSheetList: 0,
        TextTrackCueList: 0,
        TextTrackList: 0,
        TouchList: 0,
      })),
    Wo
  );
}
var Ho, tp;
function Bb() {
  if (tp) return Ho;
  tp = 1;
  var r = br().forEach,
    t = fa(),
    e = rt(),
    n = t('forEach'),
    a = e('forEach');
  return (
    (Ho =
      !n || !a
        ? function (o) {
            return r(this, o, arguments.length > 1 ? arguments[1] : void 0);
          }
        : [].forEach),
    Ho
  );
}
var np;
function Db() {
  if (np) return ep;
  np = 1;
  var r = Re(),
    t = xm(),
    e = Bb(),
    n = gr();
  for (var a in t) {
    var i = r[a],
      o = i && i.prototype;
    if (o && o.forEach !== e)
      try {
        n(o, 'forEach', e);
      } catch {
        o.forEach = e;
      }
  }
  return ep;
}
Db();
var ap = {},
  ip;
function jb() {
  if (ip) return ap;
  ip = 1;
  var r = Re(),
    t = xm(),
    e = ca(),
    n = gr(),
    a = Pe(),
    i = a('iterator'),
    o = a('toStringTag'),
    s = e.values;
  for (var u in t) {
    var l = r[u],
      c = l && l.prototype;
    if (c) {
      if (c[i] !== s)
        try {
          n(c, i, s);
        } catch {
          c[i] = s;
        }
      if ((c[o] || n(c, o, u), t[u])) {
        for (var h in e)
          if (c[h] !== e[h])
            try {
              n(c, h, e[h]);
            } catch {
              c[h] = e[h];
            }
      }
    }
  }
  return ap;
}
jb();
var op = {},
  Go,
  sp;
function Pm() {
  if (sp) return Go;
  sp = 1;
  var r = Ee(),
    t = Pe(),
    e = dt(),
    n = t('iterator');
  return (
    (Go = !r(function () {
      var a = new URL('b?a=1&b=2&c=3', 'http://a'),
        i = a.searchParams,
        o = '';
      return (
        (a.pathname = 'c%20d'),
        i.forEach(function (s, u) {
          i.delete('b'), (o += u + s);
        }),
        (e && !a.toJSON) ||
          !i.sort ||
          a.href !== 'http://a/c%20d?a=1&c=3' ||
          i.get('c') !== '3' ||
          String(new URLSearchParams('?a=1')) !== 'a=1' ||
          !i[n] ||
          new URL('https://a@b').username !== 'a' ||
          new URLSearchParams(new URLSearchParams('a=b')).get('a') !== 'b' ||
          new URL('http://тест').host !== 'xn--e1aybc' ||
          new URL('http://a#б').hash !== '#%D0%B1' ||
          o !== 'a1c3' ||
          new URL('http://x', void 0).host !== 'x'
      );
    })),
    Go
  );
}
var Vo, up;
function Lb() {
  if (up) return Vo;
  up = 1;
  var r = 2147483647,
    t = 36,
    e = 1,
    n = 26,
    a = 38,
    i = 700,
    o = 72,
    s = 128,
    u = '-',
    l = /[^\0-\u007E]/,
    c = /[.\u3002\uFF0E\uFF61]/g,
    h = 'Overflow: input needs wider integers to process',
    d = t - e,
    f = Math.floor,
    p = String.fromCharCode,
    v = function (g) {
      for (var b = [], A = 0, w = g.length; A < w; ) {
        var T = g.charCodeAt(A++);
        if (T >= 55296 && T <= 56319 && A < w) {
          var P = g.charCodeAt(A++);
          (P & 64512) == 56320 ? b.push(((T & 1023) << 10) + (P & 1023) + 65536) : (b.push(T), A--);
        } else b.push(T);
      }
      return b;
    },
    y = function (g) {
      return g + 22 + 75 * (g < 26);
    },
    E = function (g, b, A) {
      var w = 0;
      for (g = A ? f(g / i) : g >> 1, g += f(g / b); g > (d * n) >> 1; w += t) g = f(g / d);
      return f(w + ((d + 1) * g) / (g + a));
    },
    _ = function (g) {
      var b = [];
      g = v(g);
      var A = g.length,
        w = s,
        T = 0,
        P = o,
        x,
        C;
      for (x = 0; x < g.length; x++) (C = g[x]), C < 128 && b.push(p(C));
      var q = b.length,
        L = q;
      for (q && b.push(u); L < A; ) {
        var ae = r;
        for (x = 0; x < g.length; x++) (C = g[x]), C >= w && C < ae && (ae = C);
        var te = L + 1;
        if (ae - w > f((r - T) / te)) throw RangeError(h);
        for (T += (ae - w) * te, w = ae, x = 0; x < g.length; x++) {
          if (((C = g[x]), C < w && ++T > r)) throw RangeError(h);
          if (C == w) {
            for (var k = T, m = t; ; m += t) {
              var R = m <= P ? e : m >= P + n ? n : m - P;
              if (k < R) break;
              var I = k - R,
                M = t - R;
              b.push(p(y(R + (I % M)))), (k = f(I / M));
            }
            b.push(p(y(k))), (P = E(T, te, L == q)), (T = 0), ++L;
          }
        }
        ++T, ++w;
      }
      return b.join('');
    };
  return (
    (Vo = function (g) {
      var b = [],
        A = g.toLowerCase().replace(c, '.').split('.'),
        w,
        T;
      for (w = 0; w < A.length; w++) (T = A[w]), b.push(l.test(T) ? 'xn--' + _(T) : T);
      return b.join('.');
    }),
    Vo
  );
}
var $o, lp;
function Ub() {
  if (lp) return $o;
  lp = 1;
  var r = sr(),
    t = An();
  return (
    ($o = function (e) {
      var n = t(e);
      if (typeof n != 'function') throw TypeError(String(e) + ' is not iterable');
      return r(n.call(e));
    }),
    $o
  );
}
var Ko, cp;
function Im() {
  if (cp) return Ko;
  (cp = 1), ca();
  var r = ge(),
    t = Qr(),
    e = Pm(),
    n = Er(),
    a = tu(),
    i = et(),
    o = am(),
    s = Jr(),
    u = Tn(),
    l = ar(),
    c = Pt(),
    h = En(),
    d = sr(),
    f = Je(),
    p = xt(),
    v = Rt(),
    y = Ub(),
    E = An(),
    _ = Pe(),
    g = t('fetch'),
    b = t('Headers'),
    A = _('iterator'),
    w = 'URLSearchParams',
    T = w + 'Iterator',
    P = s.set,
    x = s.getterFor(w),
    C = s.getterFor(T),
    q = /\+/g,
    L = Array(4),
    ae = function (Y) {
      return L[Y - 1] || (L[Y - 1] = RegExp('((?:%[\\da-f]{2}){' + Y + '})', 'gi'));
    },
    te = function (Y) {
      try {
        return decodeURIComponent(Y);
      } catch {
        return Y;
      }
    },
    k = function (Y) {
      var z = Y.replace(q, ' '),
        Q = 4;
      try {
        return decodeURIComponent(z);
      } catch {
        for (; Q; ) z = z.replace(ae(Q--), te);
        return z;
      }
    },
    m = /[!'()~]|%20/g,
    R = { '!': '%21', "'": '%27', '(': '%28', ')': '%29', '~': '%7E', '%20': '+' },
    I = function (Y) {
      return R[Y];
    },
    M = function (Y) {
      return encodeURIComponent(Y).replace(m, I);
    },
    U = function (Y, z) {
      if (z)
        for (var Q = z.split('&'), ue = 0, G, ie; ue < Q.length; )
          (G = Q[ue++]), G.length && ((ie = G.split('=')), Y.push({ key: k(ie.shift()), value: k(ie.join('=')) }));
    },
    N = function (Y) {
      (this.entries.length = 0), U(this.entries, Y);
    },
    Z = function (Y, z) {
      if (Y < z) throw TypeError('Not enough arguments');
    },
    ne = o(
      function (z, Q) {
        P(this, { type: T, iterator: y(x(z).entries), kind: Q });
      },
      'Iterator',
      function () {
        var z = C(this),
          Q = z.kind,
          ue = z.iterator.next(),
          G = ue.value;
        return ue.done || (ue.value = Q === 'keys' ? G.key : Q === 'values' ? G.value : [G.key, G.value]), ue;
      }
    ),
    oe = function () {
      u(this, oe, w);
      var z = arguments.length > 0 ? arguments[0] : void 0,
        Q = this,
        ue = [],
        G,
        ie,
        K,
        D,
        ee,
        he,
        we,
        De,
        He;
      if ((P(Q, { type: w, entries: ue, updateURL: function () {}, updateSearchParams: N }), z !== void 0))
        if (f(z))
          if (((G = E(z)), typeof G == 'function'))
            for (ie = G.call(z), K = ie.next; !(D = K.call(ie)).done; ) {
              if (
                ((ee = y(d(D.value))),
                (he = ee.next),
                (we = he.call(ee)).done || (De = he.call(ee)).done || !he.call(ee).done)
              )
                throw TypeError('Expected sequence with length 2');
              ue.push({ key: we.value + '', value: De.value + '' });
            }
          else for (He in z) l(z, He) && ue.push({ key: He, value: z[He] + '' });
        else U(ue, typeof z == 'string' ? (z.charAt(0) === '?' ? z.slice(1) : z) : z + '');
    },
    fe = oe.prototype;
  return (
    a(
      fe,
      {
        append: function (z, Q) {
          Z(arguments.length, 2);
          var ue = x(this);
          ue.entries.push({ key: z + '', value: Q + '' }), ue.updateURL();
        },
        delete: function (Y) {
          Z(arguments.length, 1);
          for (var z = x(this), Q = z.entries, ue = Y + '', G = 0; G < Q.length; )
            Q[G].key === ue ? Q.splice(G, 1) : G++;
          z.updateURL();
        },
        get: function (z) {
          Z(arguments.length, 1);
          for (var Q = x(this).entries, ue = z + '', G = 0; G < Q.length; G++) if (Q[G].key === ue) return Q[G].value;
          return null;
        },
        getAll: function (z) {
          Z(arguments.length, 1);
          for (var Q = x(this).entries, ue = z + '', G = [], ie = 0; ie < Q.length; ie++)
            Q[ie].key === ue && G.push(Q[ie].value);
          return G;
        },
        has: function (z) {
          Z(arguments.length, 1);
          for (var Q = x(this).entries, ue = z + '', G = 0; G < Q.length; ) if (Q[G++].key === ue) return !0;
          return !1;
        },
        set: function (z, Q) {
          Z(arguments.length, 1);
          for (var ue = x(this), G = ue.entries, ie = !1, K = z + '', D = Q + '', ee = 0, he; ee < G.length; ee++)
            (he = G[ee]), he.key === K && (ie ? G.splice(ee--, 1) : ((ie = !0), (he.value = D)));
          ie || G.push({ key: K, value: D }), ue.updateURL();
        },
        sort: function () {
          var z = x(this),
            Q = z.entries,
            ue = Q.slice(),
            G,
            ie,
            K;
          for (Q.length = 0, K = 0; K < ue.length; K++) {
            for (G = ue[K], ie = 0; ie < K; ie++)
              if (Q[ie].key > G.key) {
                Q.splice(ie, 0, G);
                break;
              }
            ie === K && Q.push(G);
          }
          z.updateURL();
        },
        forEach: function (z) {
          for (
            var Q = x(this).entries, ue = c(z, arguments.length > 1 ? arguments[1] : void 0, 3), G = 0, ie;
            G < Q.length;

          )
            (ie = Q[G++]), ue(ie.value, ie.key, this);
        },
        keys: function () {
          return new ne(this, 'keys');
        },
        values: function () {
          return new ne(this, 'values');
        },
        entries: function () {
          return new ne(this, 'entries');
        },
      },
      { enumerable: !0 }
    ),
    n(fe, A, fe.entries),
    n(
      fe,
      'toString',
      function () {
        for (var z = x(this).entries, Q = [], ue = 0, G; ue < z.length; )
          (G = z[ue++]), Q.push(M(G.key) + '=' + M(G.value));
        return Q.join('&');
      },
      { enumerable: !0 }
    ),
    i(oe, w),
    r({ global: !0, forced: !e }, { URLSearchParams: oe }),
    !e &&
      typeof g == 'function' &&
      typeof b == 'function' &&
      r(
        { global: !0, enumerable: !0, forced: !0 },
        {
          fetch: function (z) {
            var Q = [z],
              ue,
              G,
              ie;
            return (
              arguments.length > 1 &&
                ((ue = arguments[1]),
                f(ue) &&
                  ((G = ue.body),
                  h(G) === w &&
                    ((ie = ue.headers ? new b(ue.headers) : new b()),
                    ie.has('content-type') || ie.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8'),
                    (ue = p(ue, { body: v(0, String(G)), headers: v(0, ie) })))),
                Q.push(ue)),
              g.apply(this, Q)
            );
          },
        }
      ),
    (Ko = { URLSearchParams: oe, getState: x }),
    Ko
  );
}
var fp;
function zb() {
  if (fp) return op;
  (fp = 1), km();
  var r = ge(),
    t = Ye(),
    e = Pm(),
    n = Re(),
    a = Zv(),
    i = Er(),
    o = Tn(),
    s = ar(),
    u = hm(),
    l = rm(),
    c = su().codeAt,
    h = Lb(),
    d = et(),
    f = Im(),
    p = Jr(),
    v = n.URL,
    y = f.URLSearchParams,
    E = f.getState,
    _ = p.set,
    g = p.getterFor('URL'),
    b = Math.floor,
    A = Math.pow,
    w = 'Invalid authority',
    T = 'Invalid scheme',
    P = 'Invalid host',
    x = 'Invalid port',
    C = /[A-Za-z]/,
    q = /[\d+\-.A-Za-z]/,
    L = /\d/,
    ae = /^(0x|0X)/,
    te = /^[0-7]+$/,
    k = /^\d+$/,
    m = /^[\dA-Fa-f]+$/,
    R = /[\u0000\u0009\u000A\u000D #%/:?@[\\]]/,
    I = /[\u0000\u0009\u000A\u000D #/:?@[\\]]/,
    M = /^[\u0000-\u001F ]+|[\u0000-\u001F ]+$/g,
    U = /[\u0009\u000A\u000D]/g,
    N,
    Z = function (S, j) {
      var B, W, V;
      if (j.charAt(0) == '[') {
        if (j.charAt(j.length - 1) != ']' || ((B = oe(j.slice(1, -1))), !B)) return P;
        S.host = B;
      } else if (D(S)) {
        if (((j = h(j)), R.test(j) || ((B = ne(j)), B === null))) return P;
        S.host = B;
      } else {
        if (I.test(j)) return P;
        for (B = '', W = l(j), V = 0; V < W.length; V++) B += ie(W[V], z);
        S.host = B;
      }
    },
    ne = function (S) {
      var j = S.split('.'),
        B,
        W,
        V,
        ye,
        le,
        xe,
        ze;
      if ((j.length && j[j.length - 1] == '' && j.pop(), (B = j.length), B > 4)) return S;
      for (W = [], V = 0; V < B; V++) {
        if (((ye = j[V]), ye == '')) return S;
        if (
          ((le = 10),
          ye.length > 1 && ye.charAt(0) == '0' && ((le = ae.test(ye) ? 16 : 8), (ye = ye.slice(le == 8 ? 1 : 2))),
          ye === '')
        )
          xe = 0;
        else {
          if (!(le == 10 ? k : le == 8 ? te : m).test(ye)) return S;
          xe = parseInt(ye, le);
        }
        W.push(xe);
      }
      for (V = 0; V < B; V++)
        if (((xe = W[V]), V == B - 1)) {
          if (xe >= A(256, 5 - B)) return null;
        } else if (xe > 255) return null;
      for (ze = W.pop(), V = 0; V < W.length; V++) ze += W[V] * A(256, 3 - V);
      return ze;
    },
    oe = function (S) {
      var j = [0, 0, 0, 0, 0, 0, 0, 0],
        B = 0,
        W = null,
        V = 0,
        ye,
        le,
        xe,
        ze,
        Ze,
        xr,
        H,
        tr = function () {
          return S.charAt(V);
        };
      if (tr() == ':') {
        if (S.charAt(1) != ':') return;
        (V += 2), B++, (W = B);
      }
      for (; tr(); ) {
        if (B == 8) return;
        if (tr() == ':') {
          if (W !== null) return;
          V++, B++, (W = B);
          continue;
        }
        for (ye = le = 0; le < 4 && m.test(tr()); ) (ye = ye * 16 + parseInt(tr(), 16)), V++, le++;
        if (tr() == '.') {
          if (le == 0 || ((V -= le), B > 6)) return;
          for (xe = 0; tr(); ) {
            if (((ze = null), xe > 0))
              if (tr() == '.' && xe < 4) V++;
              else return;
            if (!L.test(tr())) return;
            for (; L.test(tr()); ) {
              if (((Ze = parseInt(tr(), 10)), ze === null)) ze = Ze;
              else {
                if (ze == 0) return;
                ze = ze * 10 + Ze;
              }
              if (ze > 255) return;
              V++;
            }
            (j[B] = j[B] * 256 + ze), xe++, (xe == 2 || xe == 4) && B++;
          }
          if (xe != 4) return;
          break;
        } else if (tr() == ':') {
          if ((V++, !tr())) return;
        } else if (tr()) return;
        j[B++] = ye;
      }
      if (W !== null)
        for (xr = B - W, B = 7; B != 0 && xr > 0; ) (H = j[B]), (j[B--] = j[W + xr - 1]), (j[W + --xr] = H);
      else if (B != 8) return;
      return j;
    },
    fe = function (S) {
      for (var j = null, B = 1, W = null, V = 0, ye = 0; ye < 8; ye++)
        S[ye] !== 0 ? (V > B && ((j = W), (B = V)), (W = null), (V = 0)) : (W === null && (W = ye), ++V);
      return V > B && ((j = W), (B = V)), j;
    },
    Y = function (S) {
      var j, B, W, V;
      if (typeof S == 'number') {
        for (j = [], B = 0; B < 4; B++) j.unshift(S % 256), (S = b(S / 256));
        return j.join('.');
      } else if (typeof S == 'object') {
        for (j = '', W = fe(S), B = 0; B < 8; B++)
          (V && S[B] === 0) ||
            (V && (V = !1),
            W === B ? ((j += B ? ':' : '::'), (V = !0)) : ((j += S[B].toString(16)), B < 7 && (j += ':')));
        return '[' + j + ']';
      }
      return S;
    },
    z = {},
    Q = u({}, z, { ' ': 1, '"': 1, '<': 1, '>': 1, '`': 1 }),
    ue = u({}, Q, { '#': 1, '?': 1, '{': 1, '}': 1 }),
    G = u({}, ue, { '/': 1, ':': 1, ';': 1, '=': 1, '@': 1, '[': 1, '\\': 1, ']': 1, '^': 1, '|': 1 }),
    ie = function (S, j) {
      var B = c(S, 0);
      return B > 32 && B < 127 && !s(j, S) ? S : encodeURIComponent(S);
    },
    K = { ftp: 21, file: null, http: 80, https: 443, ws: 80, wss: 443 },
    D = function (S) {
      return s(K, S.scheme);
    },
    ee = function (S) {
      return S.username != '' || S.password != '';
    },
    he = function (S) {
      return !S.host || S.cannotBeABaseURL || S.scheme == 'file';
    },
    we = function (S, j) {
      var B;
      return S.length == 2 && C.test(S.charAt(0)) && ((B = S.charAt(1)) == ':' || (!j && B == '|'));
    },
    De = function (S) {
      var j;
      return (
        S.length > 1 &&
        we(S.slice(0, 2)) &&
        (S.length == 2 || (j = S.charAt(2)) === '/' || j === '\\' || j === '?' || j === '#')
      );
    },
    He = function (S) {
      var j = S.path,
        B = j.length;
      B && (S.scheme != 'file' || B != 1 || !we(j[0], !0)) && j.pop();
    },
    Fe = function (S) {
      return S === '.' || S.toLowerCase() === '%2e';
    },
    Se = function (S) {
      return (S = S.toLowerCase()), S === '..' || S === '%2e.' || S === '.%2e' || S === '%2e%2e';
    },
    Qe = {},
    dr = {},
    rr = {},
    pr = {},
    _r = {},
    Te = {},
    X = {},
    $ = {},
    ce = {},
    ve = {},
    re = {},
    J = {},
    se = {},
    de = {},
    me = {},
    Ue = {},
    er = {},
    Ge = {},
    cr = {},
    wr = {},
    vr = {},
    Rr = function (S, j, B, W) {
      var V = B || Qe,
        ye = 0,
        le = '',
        xe = !1,
        ze = !1,
        Ze = !1,
        xr,
        H,
        tr,
        $r;
      for (
        B ||
          ((S.scheme = ''),
          (S.username = ''),
          (S.password = ''),
          (S.host = null),
          (S.port = null),
          (S.path = []),
          (S.query = null),
          (S.fragment = null),
          (S.cannotBeABaseURL = !1),
          (j = j.replace(M, ''))),
          j = j.replace(U, ''),
          xr = l(j);
        ye <= xr.length;

      ) {
        switch (((H = xr[ye]), V)) {
          case Qe:
            if (H && C.test(H)) (le += H.toLowerCase()), (V = dr);
            else {
              if (B) return T;
              V = rr;
              continue;
            }
            break;
          case dr:
            if (H && (q.test(H) || H == '+' || H == '-' || H == '.')) le += H.toLowerCase();
            else if (H == ':') {
              if (
                B &&
                (D(S) != s(K, le) || (le == 'file' && (ee(S) || S.port !== null)) || (S.scheme == 'file' && !S.host))
              )
                return;
              if (((S.scheme = le), B)) {
                D(S) && K[S.scheme] == S.port && (S.port = null);
                return;
              }
              (le = ''),
                S.scheme == 'file'
                  ? (V = de)
                  : D(S) && W && W.scheme == S.scheme
                  ? (V = pr)
                  : D(S)
                  ? (V = $)
                  : xr[ye + 1] == '/'
                  ? ((V = _r), ye++)
                  : ((S.cannotBeABaseURL = !0), S.path.push(''), (V = cr));
            } else {
              if (B) return T;
              (le = ''), (V = rr), (ye = 0);
              continue;
            }
            break;
          case rr:
            if (!W || (W.cannotBeABaseURL && H != '#')) return T;
            if (W.cannotBeABaseURL && H == '#') {
              (S.scheme = W.scheme),
                (S.path = W.path.slice()),
                (S.query = W.query),
                (S.fragment = ''),
                (S.cannotBeABaseURL = !0),
                (V = vr);
              break;
            }
            V = W.scheme == 'file' ? de : Te;
            continue;
          case pr:
            if (H == '/' && xr[ye + 1] == '/') (V = ce), ye++;
            else {
              V = Te;
              continue;
            }
            break;
          case _r:
            if (H == '/') {
              V = ve;
              break;
            } else {
              V = Ge;
              continue;
            }
          case Te:
            if (((S.scheme = W.scheme), H == N))
              (S.username = W.username),
                (S.password = W.password),
                (S.host = W.host),
                (S.port = W.port),
                (S.path = W.path.slice()),
                (S.query = W.query);
            else if (H == '/' || (H == '\\' && D(S))) V = X;
            else if (H == '?')
              (S.username = W.username),
                (S.password = W.password),
                (S.host = W.host),
                (S.port = W.port),
                (S.path = W.path.slice()),
                (S.query = ''),
                (V = wr);
            else if (H == '#')
              (S.username = W.username),
                (S.password = W.password),
                (S.host = W.host),
                (S.port = W.port),
                (S.path = W.path.slice()),
                (S.query = W.query),
                (S.fragment = ''),
                (V = vr);
            else {
              (S.username = W.username),
                (S.password = W.password),
                (S.host = W.host),
                (S.port = W.port),
                (S.path = W.path.slice()),
                S.path.pop(),
                (V = Ge);
              continue;
            }
            break;
          case X:
            if (D(S) && (H == '/' || H == '\\')) V = ce;
            else if (H == '/') V = ve;
            else {
              (S.username = W.username), (S.password = W.password), (S.host = W.host), (S.port = W.port), (V = Ge);
              continue;
            }
            break;
          case $:
            if (((V = ce), H != '/' || le.charAt(ye + 1) != '/')) continue;
            ye++;
            break;
          case ce:
            if (H != '/' && H != '\\') {
              V = ve;
              continue;
            }
            break;
          case ve:
            if (H == '@') {
              xe && (le = '%40' + le), (xe = !0), (tr = l(le));
              for (var ga = 0; ga < tr.length; ga++) {
                var xu = tr[ga];
                if (xu == ':' && !Ze) {
                  Ze = !0;
                  continue;
                }
                var Pu = ie(xu, G);
                Ze ? (S.password += Pu) : (S.username += Pu);
              }
              le = '';
            } else if (H == N || H == '/' || H == '?' || H == '#' || (H == '\\' && D(S))) {
              if (xe && le == '') return w;
              (ye -= l(le).length + 1), (le = ''), (V = re);
            } else le += H;
            break;
          case re:
          case J:
            if (B && S.scheme == 'file') {
              V = Ue;
              continue;
            } else if (H == ':' && !ze) {
              if (le == '') return P;
              if ((($r = Z(S, le)), $r)) return $r;
              if (((le = ''), (V = se), B == J)) return;
            } else if (H == N || H == '/' || H == '?' || H == '#' || (H == '\\' && D(S))) {
              if (D(S) && le == '') return P;
              if (B && le == '' && (ee(S) || S.port !== null)) return;
              if ((($r = Z(S, le)), $r)) return $r;
              if (((le = ''), (V = er), B)) return;
              continue;
            } else H == '[' ? (ze = !0) : H == ']' && (ze = !1), (le += H);
            break;
          case se:
            if (L.test(H)) le += H;
            else if (H == N || H == '/' || H == '?' || H == '#' || (H == '\\' && D(S)) || B) {
              if (le != '') {
                var ba = parseInt(le, 10);
                if (ba > 65535) return x;
                (S.port = D(S) && ba === K[S.scheme] ? null : ba), (le = '');
              }
              if (B) return;
              V = er;
              continue;
            } else return x;
            break;
          case de:
            if (((S.scheme = 'file'), H == '/' || H == '\\')) V = me;
            else if (W && W.scheme == 'file')
              if (H == N) (S.host = W.host), (S.path = W.path.slice()), (S.query = W.query);
              else if (H == '?') (S.host = W.host), (S.path = W.path.slice()), (S.query = ''), (V = wr);
              else if (H == '#')
                (S.host = W.host), (S.path = W.path.slice()), (S.query = W.query), (S.fragment = ''), (V = vr);
              else {
                De(xr.slice(ye).join('')) || ((S.host = W.host), (S.path = W.path.slice()), He(S)), (V = Ge);
                continue;
              }
            else {
              V = Ge;
              continue;
            }
            break;
          case me:
            if (H == '/' || H == '\\') {
              V = Ue;
              break;
            }
            W &&
              W.scheme == 'file' &&
              !De(xr.slice(ye).join('')) &&
              (we(W.path[0], !0) ? S.path.push(W.path[0]) : (S.host = W.host)),
              (V = Ge);
            continue;
          case Ue:
            if (H == N || H == '/' || H == '\\' || H == '?' || H == '#') {
              if (!B && we(le)) V = Ge;
              else if (le == '') {
                if (((S.host = ''), B)) return;
                V = er;
              } else {
                if ((($r = Z(S, le)), $r)) return $r;
                if ((S.host == 'localhost' && (S.host = ''), B)) return;
                (le = ''), (V = er);
              }
              continue;
            } else le += H;
            break;
          case er:
            if (D(S)) {
              if (((V = Ge), H != '/' && H != '\\')) continue;
            } else if (!B && H == '?') (S.query = ''), (V = wr);
            else if (!B && H == '#') (S.fragment = ''), (V = vr);
            else if (H != N && ((V = Ge), H != '/')) continue;
            break;
          case Ge:
            if (H == N || H == '/' || (H == '\\' && D(S)) || (!B && (H == '?' || H == '#'))) {
              if (
                (Se(le)
                  ? (He(S), H != '/' && !(H == '\\' && D(S)) && S.path.push(''))
                  : Fe(le)
                  ? H != '/' && !(H == '\\' && D(S)) && S.path.push('')
                  : (S.scheme == 'file' &&
                      !S.path.length &&
                      we(le) &&
                      (S.host && (S.host = ''), (le = le.charAt(0) + ':')),
                    S.path.push(le)),
                (le = ''),
                S.scheme == 'file' && (H == N || H == '?' || H == '#'))
              )
                for (; S.path.length > 1 && S.path[0] === ''; ) S.path.shift();
              H == '?' ? ((S.query = ''), (V = wr)) : H == '#' && ((S.fragment = ''), (V = vr));
            } else le += ie(H, ue);
            break;
          case cr:
            H == '?'
              ? ((S.query = ''), (V = wr))
              : H == '#'
              ? ((S.fragment = ''), (V = vr))
              : H != N && (S.path[0] += ie(H, z));
            break;
          case wr:
            !B && H == '#'
              ? ((S.fragment = ''), (V = vr))
              : H != N &&
                (H == "'" && D(S) ? (S.query += '%27') : H == '#' ? (S.query += '%23') : (S.query += ie(H, z)));
            break;
          case vr:
            H != N && (S.fragment += ie(H, Q));
            break;
        }
        ye++;
      }
    },
    pt = function (j) {
      var B = o(this, pt, 'URL'),
        W = arguments.length > 1 ? arguments[1] : void 0,
        V = String(j),
        ye = _(B, { type: 'URL' }),
        le,
        xe;
      if (W !== void 0) {
        if (W instanceof pt) le = g(W);
        else if (((xe = Rr((le = {}), String(W))), xe)) throw TypeError(xe);
      }
      if (((xe = Rr(ye, V, null, le)), xe)) throw TypeError(xe);
      var ze = (ye.searchParams = new y()),
        Ze = E(ze);
      Ze.updateSearchParams(ye.query),
        (Ze.updateURL = function () {
          ye.query = String(ze) || null;
        }),
        t ||
          ((B.href = Cn.call(B)),
          (B.origin = vu.call(B)),
          (B.protocol = mu.call(B)),
          (B.username = yu.call(B)),
          (B.password = gu.call(B)),
          (B.host = bu.call(B)),
          (B.hostname = _u.call(B)),
          (B.port = wu.call(B)),
          (B.pathname = Su.call(B)),
          (B.search = ku.call(B)),
          (B.searchParams = Eu.call(B)),
          (B.hash = Au.call(B)));
    },
    ya = pt.prototype,
    Cn = function () {
      var S = g(this),
        j = S.scheme,
        B = S.username,
        W = S.password,
        V = S.host,
        ye = S.port,
        le = S.path,
        xe = S.query,
        ze = S.fragment,
        Ze = j + ':';
      return (
        V !== null
          ? ((Ze += '//'), ee(S) && (Ze += B + (W ? ':' + W : '') + '@'), (Ze += Y(V)), ye !== null && (Ze += ':' + ye))
          : j == 'file' && (Ze += '//'),
        (Ze += S.cannotBeABaseURL ? le[0] : le.length ? '/' + le.join('/') : ''),
        xe !== null && (Ze += '?' + xe),
        ze !== null && (Ze += '#' + ze),
        Ze
      );
    },
    vu = function () {
      var S = g(this),
        j = S.scheme,
        B = S.port;
      if (j == 'blob')
        try {
          return new URL(j.path[0]).origin;
        } catch {
          return 'null';
        }
      return j == 'file' || !D(S) ? 'null' : j + '://' + Y(S.host) + (B !== null ? ':' + B : '');
    },
    mu = function () {
      return g(this).scheme + ':';
    },
    yu = function () {
      return g(this).username;
    },
    gu = function () {
      return g(this).password;
    },
    bu = function () {
      var S = g(this),
        j = S.host,
        B = S.port;
      return j === null ? '' : B === null ? Y(j) : Y(j) + ':' + B;
    },
    _u = function () {
      var S = g(this).host;
      return S === null ? '' : Y(S);
    },
    wu = function () {
      var S = g(this).port;
      return S === null ? '' : String(S);
    },
    Su = function () {
      var S = g(this),
        j = S.path;
      return S.cannotBeABaseURL ? j[0] : j.length ? '/' + j.join('/') : '';
    },
    ku = function () {
      var S = g(this).query;
      return S ? '?' + S : '';
    },
    Eu = function () {
      return g(this).searchParams;
    },
    Au = function () {
      var S = g(this).fragment;
      return S ? '#' + S : '';
    },
    Tr = function (S, j) {
      return { get: S, set: j, configurable: !0, enumerable: !0 };
    };
  if (
    (t &&
      a(ya, {
        href: Tr(Cn, function (S) {
          var j = g(this),
            B = String(S),
            W = Rr(j, B);
          if (W) throw TypeError(W);
          E(j.searchParams).updateSearchParams(j.query);
        }),
        origin: Tr(vu),
        protocol: Tr(mu, function (S) {
          var j = g(this);
          Rr(j, String(S) + ':', Qe);
        }),
        username: Tr(yu, function (S) {
          var j = g(this),
            B = l(String(S));
          if (!he(j)) {
            j.username = '';
            for (var W = 0; W < B.length; W++) j.username += ie(B[W], G);
          }
        }),
        password: Tr(gu, function (S) {
          var j = g(this),
            B = l(String(S));
          if (!he(j)) {
            j.password = '';
            for (var W = 0; W < B.length; W++) j.password += ie(B[W], G);
          }
        }),
        host: Tr(bu, function (S) {
          var j = g(this);
          j.cannotBeABaseURL || Rr(j, String(S), re);
        }),
        hostname: Tr(_u, function (S) {
          var j = g(this);
          j.cannotBeABaseURL || Rr(j, String(S), J);
        }),
        port: Tr(wu, function (S) {
          var j = g(this);
          he(j) || ((S = String(S)), S == '' ? (j.port = null) : Rr(j, S, se));
        }),
        pathname: Tr(Su, function (S) {
          var j = g(this);
          j.cannotBeABaseURL || ((j.path = []), Rr(j, S + '', er));
        }),
        search: Tr(ku, function (S) {
          var j = g(this);
          (S = String(S)),
            S == '' ? (j.query = null) : (S.charAt(0) == '?' && (S = S.slice(1)), (j.query = ''), Rr(j, S, wr)),
            E(j.searchParams).updateSearchParams(j.query);
        }),
        searchParams: Tr(Eu),
        hash: Tr(Au, function (S) {
          var j = g(this);
          if (((S = String(S)), S == '')) {
            j.fragment = null;
            return;
          }
          S.charAt(0) == '#' && (S = S.slice(1)), (j.fragment = ''), Rr(j, S, vr);
        }),
      }),
    i(
      ya,
      'toJSON',
      function () {
        return Cn.call(this);
      },
      { enumerable: !0 }
    ),
    i(
      ya,
      'toString',
      function () {
        return Cn.call(this);
      },
      { enumerable: !0 }
    ),
    v)
  ) {
    var Ru = v.createObjectURL,
      Tu = v.revokeObjectURL;
    Ru &&
      i(pt, 'createObjectURL', function (j) {
        return Ru.apply(v, arguments);
      }),
      Tu &&
        i(pt, 'revokeObjectURL', function (j) {
          return Tu.apply(v, arguments);
        });
  }
  return d(pt, 'URL'), r({ global: !0, forced: !e, sham: !t }, { URL: pt }), op;
}
zb();
var hp = {},
  dp;
function Wb() {
  if (dp) return hp;
  dp = 1;
  var r = ge();
  return (
    r(
      { target: 'URL', proto: !0, enumerable: !0 },
      {
        toJSON: function () {
          return URL.prototype.toString.call(this);
        },
      }
    ),
    hp
  );
}
Wb();
Im();
const ft = {};
var Hb = {};
function pp(r, t) {
  var e = Object.keys(r);
  if (Object.getOwnPropertySymbols) {
    var n = Object.getOwnPropertySymbols(r);
    t &&
      (n = n.filter(function (a) {
        return Object.getOwnPropertyDescriptor(r, a).enumerable;
      })),
      e.push.apply(e, n);
  }
  return e;
}
function nr(r) {
  for (var t = 1; t < arguments.length; t++) {
    var e = arguments[t] != null ? arguments[t] : {};
    t % 2
      ? pp(Object(e), !0).forEach(function (n) {
          mt(r, n, e[n]);
        })
      : Object.getOwnPropertyDescriptors
      ? Object.defineProperties(r, Object.getOwnPropertyDescriptors(e))
      : pp(Object(e)).forEach(function (n) {
          Object.defineProperty(r, n, Object.getOwnPropertyDescriptor(e, n));
        });
  }
  return r;
}
function mt(r, t, e) {
  return (
    (t = Om(t)) in r
      ? Object.defineProperty(r, t, { value: e, enumerable: !0, configurable: !0, writable: !0 })
      : (r[t] = e),
    r
  );
}
function wt(r) {
  return $b(r) || Vb(r) || uu(r) || Gb();
}
function Gb() {
  throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
}
function Vb(r) {
  if ((typeof Symbol < 'u' && r[Symbol.iterator] != null) || r['@@iterator'] != null) return Array.from(r);
}
function $b(r) {
  if (Array.isArray(r)) return Rs(r);
}
function ct(r, t) {
  return Xb(r) || Zb(r, t) || uu(r, t) || Kb();
}
function Kb() {
  throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
}
function Zb(r, t) {
  var e = r == null ? null : (typeof Symbol < 'u' && r[Symbol.iterator]) || r['@@iterator'];
  if (e != null) {
    var n,
      a,
      i,
      o,
      s = [],
      u = !0,
      l = !1;
    try {
      if (((i = (e = e.call(r)).next), t === 0)) {
        if (Object(e) !== e) return;
        u = !1;
      } else for (; !(u = (n = i.call(e)).done) && (s.push(n.value), s.length !== t); u = !0);
    } catch (c) {
      (l = !0), (a = c);
    } finally {
      try {
        if (!u && e.return != null && ((o = e.return()), Object(o) !== o)) return;
      } finally {
        if (l) throw a;
      }
    }
    return s;
  }
}
function Xb(r) {
  if (Array.isArray(r)) return r;
}
function Ne(r, t, e) {
  return (t = Jn(t)), Yb(r, Cm() ? Reflect.construct(t, e || [], Jn(r).constructor) : t.apply(r, e));
}
function Yb(r, t) {
  if (t && (yr(t) == 'object' || typeof t == 'function')) return t;
  if (t !== void 0) throw new TypeError('Derived constructors may only return object or undefined');
  return Jb(r);
}
function Jb(r) {
  if (r === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  return r;
}
function Cm() {
  try {
    var r = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));
  } catch {}
  return (Cm = function () {
    return !!r;
  })();
}
function Jn(r) {
  return (
    (Jn = Object.setPrototypeOf
      ? Object.getPrototypeOf.bind()
      : function (t) {
          return t.__proto__ || Object.getPrototypeOf(t);
        }),
    Jn(r)
  );
}
function Me(r, t) {
  if (typeof t != 'function' && t !== null) throw new TypeError('Super expression must either be null or a function');
  (r.prototype = Object.create(t && t.prototype, { constructor: { value: r, writable: !0, configurable: !0 } })),
    Object.defineProperty(r, 'prototype', { writable: !1 }),
    t && As(r, t);
}
function As(r, t) {
  return (
    (As = Object.setPrototypeOf
      ? Object.setPrototypeOf.bind()
      : function (e, n) {
          return (e.__proto__ = n), e;
        }),
    As(r, t)
  );
}
function pe(r, t) {
  var e = (typeof Symbol < 'u' && r[Symbol.iterator]) || r['@@iterator'];
  if (!e) {
    if (Array.isArray(r) || (e = uu(r)) || t) {
      e && (r = e);
      var n = 0,
        a = function () {};
      return {
        s: a,
        n: function () {
          return n >= r.length ? { done: !0 } : { done: !1, value: r[n++] };
        },
        e: function (l) {
          throw l;
        },
        f: a,
      };
    }
    throw new TypeError(`Invalid attempt to iterate non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
  }
  var i,
    o = !0,
    s = !1;
  return {
    s: function () {
      e = e.call(r);
    },
    n: function () {
      var l = e.next();
      return (o = l.done), l;
    },
    e: function (l) {
      (s = !0), (i = l);
    },
    f: function () {
      try {
        o || e.return == null || e.return();
      } finally {
        if (s) throw i;
      }
    },
  };
}
function uu(r, t) {
  if (r) {
    if (typeof r == 'string') return Rs(r, t);
    var e = {}.toString.call(r).slice(8, -1);
    return (
      e === 'Object' && r.constructor && (e = r.constructor.name),
      e === 'Map' || e === 'Set'
        ? Array.from(r)
        : e === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)
        ? Rs(r, t)
        : void 0
    );
  }
}
function Rs(r, t) {
  (t == null || t > r.length) && (t = r.length);
  for (var e = 0, n = Array(t); e < t; e++) n[e] = r[e];
  return n;
}
function Ie() {
  /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */ Ie =
    function () {
      return t;
    };
  var r,
    t = {},
    e = Object.prototype,
    n = e.hasOwnProperty,
    a =
      Object.defineProperty ||
      function (m, R, I) {
        m[R] = I.value;
      },
    i = typeof Symbol == 'function' ? Symbol : {},
    o = i.iterator || '@@iterator',
    s = i.asyncIterator || '@@asyncIterator',
    u = i.toStringTag || '@@toStringTag';
  function l(m, R, I) {
    return Object.defineProperty(m, R, { value: I, enumerable: !0, configurable: !0, writable: !0 }), m[R];
  }
  try {
    l({}, '');
  } catch {
    l = function (I, M, U) {
      return (I[M] = U);
    };
  }
  function c(m, R, I, M) {
    var U = R && R.prototype instanceof E ? R : E,
      N = Object.create(U.prototype),
      Z = new te(M || []);
    return a(N, '_invoke', { value: C(m, I, Z) }), N;
  }
  function h(m, R, I) {
    try {
      return { type: 'normal', arg: m.call(R, I) };
    } catch (M) {
      return { type: 'throw', arg: M };
    }
  }
  t.wrap = c;
  var d = 'suspendedStart',
    f = 'suspendedYield',
    p = 'executing',
    v = 'completed',
    y = {};
  function E() {}
  function _() {}
  function g() {}
  var b = {};
  l(b, o, function () {
    return this;
  });
  var A = Object.getPrototypeOf,
    w = A && A(A(k([])));
  w && w !== e && n.call(w, o) && (b = w);
  var T = (g.prototype = E.prototype = Object.create(b));
  function P(m) {
    ['next', 'throw', 'return'].forEach(function (R) {
      l(m, R, function (I) {
        return this._invoke(R, I);
      });
    });
  }
  function x(m, R) {
    function I(U, N, Z, ne) {
      var oe = h(m[U], m, N);
      if (oe.type !== 'throw') {
        var fe = oe.arg,
          Y = fe.value;
        return Y && yr(Y) == 'object' && n.call(Y, '__await')
          ? R.resolve(Y.__await).then(
              function (z) {
                I('next', z, Z, ne);
              },
              function (z) {
                I('throw', z, Z, ne);
              }
            )
          : R.resolve(Y).then(
              function (z) {
                (fe.value = z), Z(fe);
              },
              function (z) {
                return I('throw', z, Z, ne);
              }
            );
      }
      ne(oe.arg);
    }
    var M;
    a(this, '_invoke', {
      value: function (N, Z) {
        function ne() {
          return new R(function (oe, fe) {
            I(N, Z, oe, fe);
          });
        }
        return (M = M ? M.then(ne, ne) : ne());
      },
    });
  }
  function C(m, R, I) {
    var M = d;
    return function (U, N) {
      if (M === p) throw Error('Generator is already running');
      if (M === v) {
        if (U === 'throw') throw N;
        return { value: r, done: !0 };
      }
      for (I.method = U, I.arg = N; ; ) {
        var Z = I.delegate;
        if (Z) {
          var ne = q(Z, I);
          if (ne) {
            if (ne === y) continue;
            return ne;
          }
        }
        if (I.method === 'next') I.sent = I._sent = I.arg;
        else if (I.method === 'throw') {
          if (M === d) throw ((M = v), I.arg);
          I.dispatchException(I.arg);
        } else I.method === 'return' && I.abrupt('return', I.arg);
        M = p;
        var oe = h(m, R, I);
        if (oe.type === 'normal') {
          if (((M = I.done ? v : f), oe.arg === y)) continue;
          return { value: oe.arg, done: I.done };
        }
        oe.type === 'throw' && ((M = v), (I.method = 'throw'), (I.arg = oe.arg));
      }
    };
  }
  function q(m, R) {
    var I = R.method,
      M = m.iterator[I];
    if (M === r)
      return (
        (R.delegate = null),
        (I === 'throw' && m.iterator.return && ((R.method = 'return'), (R.arg = r), q(m, R), R.method === 'throw')) ||
          (I !== 'return' &&
            ((R.method = 'throw'), (R.arg = new TypeError("The iterator does not provide a '" + I + "' method")))),
        y
      );
    var U = h(M, m.iterator, R.arg);
    if (U.type === 'throw') return (R.method = 'throw'), (R.arg = U.arg), (R.delegate = null), y;
    var N = U.arg;
    return N
      ? N.done
        ? ((R[m.resultName] = N.value),
          (R.next = m.nextLoc),
          R.method !== 'return' && ((R.method = 'next'), (R.arg = r)),
          (R.delegate = null),
          y)
        : N
      : ((R.method = 'throw'), (R.arg = new TypeError('iterator result is not an object')), (R.delegate = null), y);
  }
  function L(m) {
    var R = { tryLoc: m[0] };
    1 in m && (R.catchLoc = m[1]), 2 in m && ((R.finallyLoc = m[2]), (R.afterLoc = m[3])), this.tryEntries.push(R);
  }
  function ae(m) {
    var R = m.completion || {};
    (R.type = 'normal'), delete R.arg, (m.completion = R);
  }
  function te(m) {
    (this.tryEntries = [{ tryLoc: 'root' }]), m.forEach(L, this), this.reset(!0);
  }
  function k(m) {
    if (m || m === '') {
      var R = m[o];
      if (R) return R.call(m);
      if (typeof m.next == 'function') return m;
      if (!isNaN(m.length)) {
        var I = -1,
          M = function U() {
            for (; ++I < m.length; ) if (n.call(m, I)) return (U.value = m[I]), (U.done = !1), U;
            return (U.value = r), (U.done = !0), U;
          };
        return (M.next = M);
      }
    }
    throw new TypeError(yr(m) + ' is not iterable');
  }
  return (
    (_.prototype = g),
    a(T, 'constructor', { value: g, configurable: !0 }),
    a(g, 'constructor', { value: _, configurable: !0 }),
    (_.displayName = l(g, u, 'GeneratorFunction')),
    (t.isGeneratorFunction = function (m) {
      var R = typeof m == 'function' && m.constructor;
      return !!R && (R === _ || (R.displayName || R.name) === 'GeneratorFunction');
    }),
    (t.mark = function (m) {
      return (
        Object.setPrototypeOf ? Object.setPrototypeOf(m, g) : ((m.__proto__ = g), l(m, u, 'GeneratorFunction')),
        (m.prototype = Object.create(T)),
        m
      );
    }),
    (t.awrap = function (m) {
      return { __await: m };
    }),
    P(x.prototype),
    l(x.prototype, s, function () {
      return this;
    }),
    (t.AsyncIterator = x),
    (t.async = function (m, R, I, M, U) {
      U === void 0 && (U = Promise);
      var N = new x(c(m, R, I, M), U);
      return t.isGeneratorFunction(R)
        ? N
        : N.next().then(function (Z) {
            return Z.done ? Z.value : N.next();
          });
    }),
    P(T),
    l(T, u, 'Generator'),
    l(T, o, function () {
      return this;
    }),
    l(T, 'toString', function () {
      return '[object Generator]';
    }),
    (t.keys = function (m) {
      var R = Object(m),
        I = [];
      for (var M in R) I.push(M);
      return (
        I.reverse(),
        function U() {
          for (; I.length; ) {
            var N = I.pop();
            if (N in R) return (U.value = N), (U.done = !1), U;
          }
          return (U.done = !0), U;
        }
      );
    }),
    (t.values = k),
    (te.prototype = {
      constructor: te,
      reset: function (R) {
        if (
          ((this.prev = 0),
          (this.next = 0),
          (this.sent = this._sent = r),
          (this.done = !1),
          (this.delegate = null),
          (this.method = 'next'),
          (this.arg = r),
          this.tryEntries.forEach(ae),
          !R)
        )
          for (var I in this) I.charAt(0) === 't' && n.call(this, I) && !isNaN(+I.slice(1)) && (this[I] = r);
      },
      stop: function () {
        this.done = !0;
        var R = this.tryEntries[0].completion;
        if (R.type === 'throw') throw R.arg;
        return this.rval;
      },
      dispatchException: function (R) {
        if (this.done) throw R;
        var I = this;
        function M(fe, Y) {
          return (Z.type = 'throw'), (Z.arg = R), (I.next = fe), Y && ((I.method = 'next'), (I.arg = r)), !!Y;
        }
        for (var U = this.tryEntries.length - 1; U >= 0; --U) {
          var N = this.tryEntries[U],
            Z = N.completion;
          if (N.tryLoc === 'root') return M('end');
          if (N.tryLoc <= this.prev) {
            var ne = n.call(N, 'catchLoc'),
              oe = n.call(N, 'finallyLoc');
            if (ne && oe) {
              if (this.prev < N.catchLoc) return M(N.catchLoc, !0);
              if (this.prev < N.finallyLoc) return M(N.finallyLoc);
            } else if (ne) {
              if (this.prev < N.catchLoc) return M(N.catchLoc, !0);
            } else {
              if (!oe) throw Error('try statement without catch or finally');
              if (this.prev < N.finallyLoc) return M(N.finallyLoc);
            }
          }
        }
      },
      abrupt: function (R, I) {
        for (var M = this.tryEntries.length - 1; M >= 0; --M) {
          var U = this.tryEntries[M];
          if (U.tryLoc <= this.prev && n.call(U, 'finallyLoc') && this.prev < U.finallyLoc) {
            var N = U;
            break;
          }
        }
        N && (R === 'break' || R === 'continue') && N.tryLoc <= I && I <= N.finallyLoc && (N = null);
        var Z = N ? N.completion : {};
        return (
          (Z.type = R), (Z.arg = I), N ? ((this.method = 'next'), (this.next = N.finallyLoc), y) : this.complete(Z)
        );
      },
      complete: function (R, I) {
        if (R.type === 'throw') throw R.arg;
        return (
          R.type === 'break' || R.type === 'continue'
            ? (this.next = R.arg)
            : R.type === 'return'
            ? ((this.rval = this.arg = R.arg), (this.method = 'return'), (this.next = 'end'))
            : R.type === 'normal' && I && (this.next = I),
          y
        );
      },
      finish: function (R) {
        for (var I = this.tryEntries.length - 1; I >= 0; --I) {
          var M = this.tryEntries[I];
          if (M.finallyLoc === R) return this.complete(M.completion, M.afterLoc), ae(M), y;
        }
      },
      catch: function (R) {
        for (var I = this.tryEntries.length - 1; I >= 0; --I) {
          var M = this.tryEntries[I];
          if (M.tryLoc === R) {
            var U = M.completion;
            if (U.type === 'throw') {
              var N = U.arg;
              ae(M);
            }
            return N;
          }
        }
        throw Error('illegal catch attempt');
      },
      delegateYield: function (R, I, M) {
        return (
          (this.delegate = { iterator: k(R), resultName: I, nextLoc: M }), this.method === 'next' && (this.arg = r), y
        );
      },
    }),
    t
  );
}
function vp(r, t, e, n, a, i, o) {
  try {
    var s = r[i](o),
      u = s.value;
  } catch (l) {
    return void e(l);
  }
  s.done ? t(u) : Promise.resolve(u).then(n, a);
}
function Sr(r) {
  return function () {
    var t = this,
      e = arguments;
    return new Promise(function (n, a) {
      var i = r.apply(t, e);
      function o(u) {
        vp(i, n, a, o, s, 'next', u);
      }
      function s(u) {
        vp(i, n, a, o, s, 'throw', u);
      }
      o(void 0);
    });
  };
}
function be(r, t) {
  if (!(r instanceof t)) throw new TypeError('Cannot call a class as a function');
}
function mp(r, t) {
  for (var e = 0; e < t.length; e++) {
    var n = t[e];
    (n.enumerable = n.enumerable || !1),
      (n.configurable = !0),
      'value' in n && (n.writable = !0),
      Object.defineProperty(r, Om(n.key), n);
  }
}
function _e(r, t, e) {
  return t && mp(r.prototype, t), e && mp(r, e), Object.defineProperty(r, 'prototype', { writable: !1 }), r;
}
function Om(r) {
  var t = Qb(r, 'string');
  return yr(t) == 'symbol' ? t : t + '';
}
function Qb(r, t) {
  if (yr(r) != 'object' || !r) return r;
  var e = r[Symbol.toPrimitive];
  if (e !== void 0) {
    var n = e.call(r, t);
    if (yr(n) != 'object') return n;
    throw new TypeError('@@toPrimitive must return a primitive value.');
  }
  return String(r);
}
function yr(r) {
  '@babel/helpers - typeof';
  return (
    (yr =
      typeof Symbol == 'function' && typeof Symbol.iterator == 'symbol'
        ? function (t) {
            return typeof t;
          }
        : function (t) {
            return t && typeof Symbol == 'function' && t.constructor === Symbol && t !== Symbol.prototype
              ? 'symbol'
              : typeof t;
          }),
    yr(r)
  );
}
window.setImmediate === void 0 &&
  (window.setImmediate = function (r) {
    for (var t = arguments.length, e = new Array(t > 1 ? t - 1 : 0), n = 1; n < t; n++) e[n - 1] = arguments[n];
    setTimeout(function () {
      return r(e);
    });
  });
var fr =
  typeof globalThis < 'u'
    ? globalThis
    : typeof window < 'u'
    ? window
    : typeof global < 'u'
    ? global
    : typeof self < 'u'
    ? self
    : {};
function e_(r) {
  return r && r.__esModule && Object.prototype.hasOwnProperty.call(r, 'default') ? r.default : r;
}
var yp,
  gp,
  bp,
  _p,
  wp,
  Kt = {},
  Sp = {},
  Xe = {},
  Zo = { exports: {} },
  Mn = { exports: {} };
function da() {
  return (
    yp ||
      ((yp = 1),
      typeof process > 'u' ||
      !process.version ||
      process.version.indexOf('v0.') === 0 ||
      (process.version.indexOf('v1.') === 0 && process.version.indexOf('v1.8.') !== 0)
        ? (Mn.exports = {
            nextTick: function (t, e, n, a) {
              if (typeof t != 'function') throw new TypeError('"callback" argument must be a function');
              var i,
                o,
                s = arguments.length;
              switch (s) {
                case 0:
                case 1:
                  return process.nextTick(t);
                case 2:
                  return process.nextTick(function () {
                    t.call(null, e);
                  });
                case 3:
                  return process.nextTick(function () {
                    t.call(null, e, n);
                  });
                case 4:
                  return process.nextTick(function () {
                    t.call(null, e, n, a);
                  });
                default:
                  for (i = new Array(s - 1), o = 0; o < i.length; ) i[o++] = arguments[o];
                  return process.nextTick(function () {
                    t.apply(null, i);
                  });
              }
            },
          })
        : (Mn.exports = process)),
    Mn.exports
  );
}
function Nm() {
  return wp ? _p : ((wp = 1), (_p = ft));
}
var kp,
  Xo = { exports: {} };
function pa() {
  return (
    kp ||
      ((kp = 1),
      (function (r, t) {
        var e = ft,
          n = e.Buffer;
        function a(o, s) {
          for (var u in o) s[u] = o[u];
        }
        function i(o, s, u) {
          return n(o, s, u);
        }
        n.from && n.alloc && n.allocUnsafe && n.allocUnsafeSlow ? (r.exports = e) : (a(e, t), (t.Buffer = i)),
          a(n, i),
          (i.from = function (o, s, u) {
            if (typeof o == 'number') throw new TypeError('Argument must not be a number');
            return n(o, s, u);
          }),
          (i.alloc = function (o, s, u) {
            if (typeof o != 'number') throw new TypeError('Argument must be a number');
            var l = n(o);
            return s !== void 0 ? (typeof u == 'string' ? l.fill(s, u) : l.fill(s)) : l.fill(0), l;
          }),
          (i.allocUnsafe = function (o) {
            if (typeof o != 'number') throw new TypeError('Argument must be a number');
            return n(o);
          }),
          (i.allocUnsafeSlow = function (o) {
            if (typeof o != 'number') throw new TypeError('Argument must be a number');
            return e.SlowBuffer(o);
          });
      })(Xo, Xo.exports)),
    Xo.exports
  );
}
var Ep,
  ir = {};
function xn() {
  if (Ep) return ir;
  function r(t) {
    return Object.prototype.toString.call(t);
  }
  return (
    (Ep = 1),
    (ir.isArray = function (t) {
      return Array.isArray ? Array.isArray(t) : r(t) === '[object Array]';
    }),
    (ir.isBoolean = function (t) {
      return typeof t == 'boolean';
    }),
    (ir.isNull = function (t) {
      return t === null;
    }),
    (ir.isNullOrUndefined = function (t) {
      return t == null;
    }),
    (ir.isNumber = function (t) {
      return typeof t == 'number';
    }),
    (ir.isString = function (t) {
      return typeof t == 'string';
    }),
    (ir.isSymbol = function (t) {
      return yr(t) == 'symbol';
    }),
    (ir.isUndefined = function (t) {
      return t === void 0;
    }),
    (ir.isRegExp = function (t) {
      return r(t) === '[object RegExp]';
    }),
    (ir.isObject = function (t) {
      return yr(t) == 'object' && t !== null;
    }),
    (ir.isDate = function (t) {
      return r(t) === '[object Date]';
    }),
    (ir.isError = function (t) {
      return r(t) === '[object Error]' || t instanceof Error;
    }),
    (ir.isFunction = function (t) {
      return typeof t == 'function';
    }),
    (ir.isPrimitive = function (t) {
      return (
        t === null ||
        typeof t == 'boolean' ||
        typeof t == 'number' ||
        typeof t == 'string' ||
        yr(t) == 'symbol' ||
        t === void 0
      );
    }),
    (ir.isBuffer = ft.Buffer.isBuffer),
    ir
  );
}
var Ap,
  Rp,
  Fn = { exports: {} },
  Yo = { exports: {} };
function Pn() {
  if (Rp) return Fn.exports;
  Rp = 1;
  try {
    var r = require('util');
    if (typeof r.inherits != 'function') throw '';
    Fn.exports = r.inherits;
  } catch {
    Fn.exports =
      (Ap ||
        ((Ap = 1),
        typeof Object.create == 'function'
          ? (Yo.exports = function (e, n) {
              n &&
                ((e.super_ = n),
                (e.prototype = Object.create(n.prototype, {
                  constructor: { value: e, enumerable: !1, writable: !0, configurable: !0 },
                })));
            })
          : (Yo.exports = function (e, n) {
              if (n) {
                e.super_ = n;
                var a = function () {};
                (a.prototype = n.prototype), (e.prototype = new a()), (e.prototype.constructor = e);
              }
            })),
      Yo.exports);
  }
  return Fn.exports;
}
var Tp,
  Jo,
  xp,
  Pp,
  Ip,
  Qo,
  Cp,
  es,
  Op,
  Np = { exports: {} };
function r_() {
  return (
    Tp ||
      ((Tp = 1),
      (function (r) {
        var t = pa().Buffer,
          e = ft;
        (r.exports = (function () {
          function n() {
            (function (a, i) {
              if (!(a instanceof i)) throw new TypeError('Cannot call a class as a function');
            })(this, n),
              (this.head = null),
              (this.tail = null),
              (this.length = 0);
          }
          return (
            (n.prototype.push = function (a) {
              var i = { data: a, next: null };
              this.length > 0 ? (this.tail.next = i) : (this.head = i), (this.tail = i), ++this.length;
            }),
            (n.prototype.unshift = function (a) {
              var i = { data: a, next: this.head };
              this.length === 0 && (this.tail = i), (this.head = i), ++this.length;
            }),
            (n.prototype.shift = function () {
              if (this.length !== 0) {
                var a = this.head.data;
                return (
                  this.length === 1 ? (this.head = this.tail = null) : (this.head = this.head.next), --this.length, a
                );
              }
            }),
            (n.prototype.clear = function () {
              (this.head = this.tail = null), (this.length = 0);
            }),
            (n.prototype.join = function (a) {
              if (this.length === 0) return '';
              for (var i = this.head, o = '' + i.data; (i = i.next); ) o += a + i.data;
              return o;
            }),
            (n.prototype.concat = function (a) {
              if (this.length === 0) return t.alloc(0);
              for (var i, o, s, u = t.allocUnsafe(a >>> 0), l = this.head, c = 0; l; )
                (i = l.data), (o = u), (s = c), i.copy(o, s), (c += l.data.length), (l = l.next);
              return u;
            }),
            n
          );
        })()),
          e &&
            e.inspect &&
            e.inspect.custom &&
            (r.exports.prototype[e.inspect.custom] = function () {
              var n = e.inspect({ length: this.length });
              return this.constructor.name + ' ' + n;
            });
      })(Np)),
    Np.exports
  );
}
function Mm() {
  if (xp) return Jo;
  xp = 1;
  var r = da();
  function t(e, n) {
    e.emit('error', n);
  }
  return (
    (Jo = {
      destroy: function (n, a) {
        var i = this,
          o = this._readableState && this._readableState.destroyed,
          s = this._writableState && this._writableState.destroyed;
        return o || s
          ? (a
              ? a(n)
              : n &&
                (this._writableState
                  ? this._writableState.errorEmitted ||
                    ((this._writableState.errorEmitted = !0), r.nextTick(t, this, n))
                  : r.nextTick(t, this, n)),
            this)
          : (this._readableState && (this._readableState.destroyed = !0),
            this._writableState && (this._writableState.destroyed = !0),
            this._destroy(n || null, function (u) {
              !a && u
                ? i._writableState
                  ? i._writableState.errorEmitted || ((i._writableState.errorEmitted = !0), r.nextTick(t, i, u))
                  : r.nextTick(t, i, u)
                : a && a(u);
            }),
            this);
      },
      undestroy: function () {
        this._readableState &&
          ((this._readableState.destroyed = !1),
          (this._readableState.reading = !1),
          (this._readableState.ended = !1),
          (this._readableState.endEmitted = !1)),
          this._writableState &&
            ((this._writableState.destroyed = !1),
            (this._writableState.ended = !1),
            (this._writableState.ending = !1),
            (this._writableState.finalCalled = !1),
            (this._writableState.prefinished = !1),
            (this._writableState.finished = !1),
            (this._writableState.errorEmitted = !1));
      },
    }),
    Jo
  );
}
function Fm() {
  if (Cp) return Qo;
  Cp = 1;
  var r = da();
  function t(b) {
    var A = this;
    (this.next = null),
      (this.entry = null),
      (this.finish = function () {
        (function (w, T, P) {
          var x = w.entry;
          for (w.entry = null; x; ) {
            var C = x.callback;
            T.pendingcb--, C(P), (x = x.next);
          }
          T.corkedRequestsFree.next = w;
        })(A, b);
      });
  }
  Qo = f;
  var e,
    n = !process.browser && ['v0.10', 'v0.9.'].indexOf(process.version.slice(0, 5)) > -1 ? setImmediate : r.nextTick;
  f.WritableState = d;
  var a = Object.create(xn());
  a.inherits = Pn();
  var i = { deprecate: Ip ? Pp : ((Ip = 1), (Pp = ft.deprecate)) },
    o = Nm(),
    s = pa().Buffer,
    u =
      (fr !== void 0 ? fr : typeof window < 'u' ? window : typeof self < 'u' ? self : {}).Uint8Array || function () {},
    l,
    c = Mm();
  function h() {}
  function d(b, A) {
    (e = e || Ut()), (b = b || {});
    var w = A instanceof e;
    (this.objectMode = !!b.objectMode), w && (this.objectMode = this.objectMode || !!b.writableObjectMode);
    var T = b.highWaterMark,
      P = b.writableHighWaterMark,
      x = this.objectMode ? 16 : 16384;
    (this.highWaterMark = T || T === 0 ? T : w && (P || P === 0) ? P : x),
      (this.highWaterMark = Math.floor(this.highWaterMark)),
      (this.finalCalled = !1),
      (this.needDrain = !1),
      (this.ending = !1),
      (this.ended = !1),
      (this.finished = !1),
      (this.destroyed = !1);
    var C = b.decodeStrings === !1;
    (this.decodeStrings = !C),
      (this.defaultEncoding = b.defaultEncoding || 'utf8'),
      (this.length = 0),
      (this.writing = !1),
      (this.corked = 0),
      (this.sync = !0),
      (this.bufferProcessing = !1),
      (this.onwrite = function (q) {
        (function (L, ae) {
          var te = L._writableState,
            k = te.sync,
            m = te.writecb;
          if (
            ((function (I) {
              (I.writing = !1), (I.writecb = null), (I.length -= I.writelen), (I.writelen = 0);
            })(te),
            ae)
          )
            (function (I, M, U, N, Z) {
              --M.pendingcb,
                U
                  ? (r.nextTick(Z, N), r.nextTick(g, I, M), (I._writableState.errorEmitted = !0), I.emit('error', N))
                  : (Z(N), (I._writableState.errorEmitted = !0), I.emit('error', N), g(I, M));
            })(L, te, k, ae, m);
          else {
            var R = E(te);
            R || te.corked || te.bufferProcessing || !te.bufferedRequest || y(L, te),
              k ? n(v, L, te, R, m) : v(L, te, R, m);
          }
        })(A, q);
      }),
      (this.writecb = null),
      (this.writelen = 0),
      (this.bufferedRequest = null),
      (this.lastBufferedRequest = null),
      (this.pendingcb = 0),
      (this.prefinished = !1),
      (this.errorEmitted = !1),
      (this.bufferedRequestCount = 0),
      (this.corkedRequestsFree = new t(this));
  }
  function f(b) {
    if (((e = e || Ut()), !(l.call(f, this) || this instanceof e))) return new f(b);
    (this._writableState = new d(b, this)),
      (this.writable = !0),
      b &&
        (typeof b.write == 'function' && (this._write = b.write),
        typeof b.writev == 'function' && (this._writev = b.writev),
        typeof b.destroy == 'function' && (this._destroy = b.destroy),
        typeof b.final == 'function' && (this._final = b.final)),
      o.call(this);
  }
  function p(b, A, w, T, P, x, C) {
    (A.writelen = T),
      (A.writecb = C),
      (A.writing = !0),
      (A.sync = !0),
      w ? b._writev(P, A.onwrite) : b._write(P, x, A.onwrite),
      (A.sync = !1);
  }
  function v(b, A, w, T) {
    w ||
      (function (P, x) {
        x.length === 0 && x.needDrain && ((x.needDrain = !1), P.emit('drain'));
      })(b, A),
      A.pendingcb--,
      T(),
      g(b, A);
  }
  function y(b, A) {
    A.bufferProcessing = !0;
    var w = A.bufferedRequest;
    if (b._writev && w && w.next) {
      var T = A.bufferedRequestCount,
        P = new Array(T),
        x = A.corkedRequestsFree;
      x.entry = w;
      for (var C = 0, q = !0; w; ) (P[C] = w), w.isBuf || (q = !1), (w = w.next), (C += 1);
      (P.allBuffers = q),
        p(b, A, !0, A.length, P, '', x.finish),
        A.pendingcb++,
        (A.lastBufferedRequest = null),
        x.next ? ((A.corkedRequestsFree = x.next), (x.next = null)) : (A.corkedRequestsFree = new t(A)),
        (A.bufferedRequestCount = 0);
    } else {
      for (; w; ) {
        var L = w.chunk,
          ae = w.encoding,
          te = w.callback;
        if ((p(b, A, !1, A.objectMode ? 1 : L.length, L, ae, te), (w = w.next), A.bufferedRequestCount--, A.writing))
          break;
      }
      w === null && (A.lastBufferedRequest = null);
    }
    (A.bufferedRequest = w), (A.bufferProcessing = !1);
  }
  function E(b) {
    return b.ending && b.length === 0 && b.bufferedRequest === null && !b.finished && !b.writing;
  }
  function _(b, A) {
    b._final(function (w) {
      A.pendingcb--, w && b.emit('error', w), (A.prefinished = !0), b.emit('prefinish'), g(b, A);
    });
  }
  function g(b, A) {
    var w = E(A);
    return (
      w &&
        ((function (T, P) {
          P.prefinished ||
            P.finalCalled ||
            (typeof T._final == 'function'
              ? (P.pendingcb++, (P.finalCalled = !0), r.nextTick(_, T, P))
              : ((P.prefinished = !0), T.emit('prefinish')));
        })(b, A),
        A.pendingcb === 0 && ((A.finished = !0), b.emit('finish'))),
      w
    );
  }
  return (
    a.inherits(f, o),
    (d.prototype.getBuffer = function () {
      for (var b = this.bufferedRequest, A = []; b; ) A.push(b), (b = b.next);
      return A;
    }),
    (function () {
      try {
        Object.defineProperty(d.prototype, 'buffer', {
          get: i.deprecate(
            function () {
              return this.getBuffer();
            },
            '_writableState.buffer is deprecated. Use _writableState.getBuffer instead.',
            'DEP0003'
          ),
        });
      } catch {}
    })(),
    typeof Symbol == 'function' && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] == 'function'
      ? ((l = Function.prototype[Symbol.hasInstance]),
        Object.defineProperty(f, Symbol.hasInstance, {
          value: function (A) {
            return !!l.call(this, A) || (this === f && A && A._writableState instanceof d);
          },
        }))
      : (l = function (A) {
          return A instanceof this;
        }),
    (f.prototype.pipe = function () {
      this.emit('error', new Error('Cannot pipe, not readable'));
    }),
    (f.prototype.write = function (b, A, w) {
      var T,
        P = this._writableState,
        x = !1,
        C = !P.objectMode && ((T = b), s.isBuffer(T) || T instanceof u);
      return (
        C &&
          !s.isBuffer(b) &&
          (b = (function (q) {
            return s.from(q);
          })(b)),
        typeof A == 'function' && ((w = A), (A = null)),
        C ? (A = 'buffer') : A || (A = P.defaultEncoding),
        typeof w != 'function' && (w = h),
        P.ended
          ? (function (q, L) {
              var ae = new Error('write after end');
              q.emit('error', ae), r.nextTick(L, ae);
            })(this, w)
          : (C ||
              (function (q, L, ae, te) {
                var k = !0,
                  m = !1;
                return (
                  ae === null
                    ? (m = new TypeError('May not write null values to stream'))
                    : typeof ae == 'string' ||
                      ae === void 0 ||
                      L.objectMode ||
                      (m = new TypeError('Invalid non-string/buffer chunk')),
                  m && (q.emit('error', m), r.nextTick(te, m), (k = !1)),
                  k
                );
              })(this, P, b, w)) &&
            (P.pendingcb++,
            (x = (function (q, L, ae, te, k, m) {
              if (!ae) {
                var R = (function (N, Z, ne) {
                  return N.objectMode || N.decodeStrings === !1 || typeof Z != 'string' || (Z = s.from(Z, ne)), Z;
                })(L, te, k);
                te !== R && ((ae = !0), (k = 'buffer'), (te = R));
              }
              var I = L.objectMode ? 1 : te.length;
              L.length += I;
              var M = L.length < L.highWaterMark;
              if ((M || (L.needDrain = !0), L.writing || L.corked)) {
                var U = L.lastBufferedRequest;
                (L.lastBufferedRequest = { chunk: te, encoding: k, isBuf: ae, callback: m, next: null }),
                  U ? (U.next = L.lastBufferedRequest) : (L.bufferedRequest = L.lastBufferedRequest),
                  (L.bufferedRequestCount += 1);
              } else p(q, L, !1, I, te, k, m);
              return M;
            })(this, P, C, b, A, w))),
        x
      );
    }),
    (f.prototype.cork = function () {
      this._writableState.corked++;
    }),
    (f.prototype.uncork = function () {
      var b = this._writableState;
      b.corked && (b.corked--, b.writing || b.corked || b.bufferProcessing || !b.bufferedRequest || y(this, b));
    }),
    (f.prototype.setDefaultEncoding = function (b) {
      if (
        (typeof b == 'string' && (b = b.toLowerCase()),
        !(
          ['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf(
            (b + '').toLowerCase()
          ) > -1
        ))
      )
        throw new TypeError('Unknown encoding: ' + b);
      return (this._writableState.defaultEncoding = b), this;
    }),
    Object.defineProperty(f.prototype, 'writableHighWaterMark', {
      enumerable: !1,
      get: function () {
        return this._writableState.highWaterMark;
      },
    }),
    (f.prototype._write = function (b, A, w) {
      w(new Error('_write() is not implemented'));
    }),
    (f.prototype._writev = null),
    (f.prototype.end = function (b, A, w) {
      var T = this._writableState;
      typeof b == 'function' ? ((w = b), (b = null), (A = null)) : typeof A == 'function' && ((w = A), (A = null)),
        b != null && this.write(b, A),
        T.corked && ((T.corked = 1), this.uncork()),
        T.ending ||
          (function (P, x, C) {
            (x.ending = !0),
              g(P, x),
              C && (x.finished ? r.nextTick(C) : P.once('finish', C)),
              (x.ended = !0),
              (P.writable = !1);
          })(this, T, w);
    }),
    Object.defineProperty(f.prototype, 'destroyed', {
      get: function () {
        return this._writableState !== void 0 && this._writableState.destroyed;
      },
      set: function (A) {
        this._writableState && (this._writableState.destroyed = A);
      },
    }),
    (f.prototype.destroy = c.destroy),
    (f.prototype._undestroy = c.undestroy),
    (f.prototype._destroy = function (b, A) {
      this.end(), A(b);
    }),
    Qo
  );
}
function Ut() {
  if (Op) return es;
  Op = 1;
  var r = da(),
    t =
      Object.keys ||
      function (h) {
        var d = [];
        for (var f in h) d.push(f);
        return d;
      };
  es = u;
  var e = Object.create(xn());
  e.inherits = Pn();
  var n = qm(),
    a = Fm();
  e.inherits(u, n);
  for (var i = t(a.prototype), o = 0; o < i.length; o++) {
    var s = i[o];
    u.prototype[s] || (u.prototype[s] = a.prototype[s]);
  }
  function u(h) {
    if (!(this instanceof u)) return new u(h);
    n.call(this, h),
      a.call(this, h),
      h && h.readable === !1 && (this.readable = !1),
      h && h.writable === !1 && (this.writable = !1),
      (this.allowHalfOpen = !0),
      h && h.allowHalfOpen === !1 && (this.allowHalfOpen = !1),
      this.once('end', l);
  }
  function l() {
    this.allowHalfOpen || this._writableState.ended || r.nextTick(c, this);
  }
  function c(h) {
    h.end();
  }
  return (
    Object.defineProperty(u.prototype, 'writableHighWaterMark', {
      enumerable: !1,
      get: function () {
        return this._writableState.highWaterMark;
      },
    }),
    Object.defineProperty(u.prototype, 'destroyed', {
      get: function () {
        return (
          this._readableState !== void 0 &&
          this._writableState !== void 0 &&
          this._readableState.destroyed &&
          this._writableState.destroyed
        );
      },
      set: function (d) {
        this._readableState !== void 0 &&
          this._writableState !== void 0 &&
          ((this._readableState.destroyed = d), (this._writableState.destroyed = d));
      },
    }),
    (u.prototype._destroy = function (h, d) {
      this.push(null), this.end(), r.nextTick(d, h);
    }),
    es
  );
}
var Mp,
  rs,
  Fp,
  ts,
  qp,
  ns,
  Bp,
  Dp,
  as = {};
function jp() {
  if (Mp) return as;
  Mp = 1;
  var r = pa().Buffer,
    t =
      r.isEncoding ||
      function (h) {
        switch ((h = '' + h) && h.toLowerCase()) {
          case 'hex':
          case 'utf8':
          case 'utf-8':
          case 'ascii':
          case 'binary':
          case 'base64':
          case 'ucs2':
          case 'ucs-2':
          case 'utf16le':
          case 'utf-16le':
          case 'raw':
            return !0;
          default:
            return !1;
        }
      };
  function e(h) {
    var d;
    switch (
      ((this.encoding = (function (f) {
        var p = (function (v) {
          if (!v) return 'utf8';
          for (var y; ; )
            switch (v) {
              case 'utf8':
              case 'utf-8':
                return 'utf8';
              case 'ucs2':
              case 'ucs-2':
              case 'utf16le':
              case 'utf-16le':
                return 'utf16le';
              case 'latin1':
              case 'binary':
                return 'latin1';
              case 'base64':
              case 'ascii':
              case 'hex':
                return v;
              default:
                if (y) return;
                (v = ('' + v).toLowerCase()), (y = !0);
            }
        })(f);
        if (typeof p != 'string' && (r.isEncoding === t || !t(f))) throw new Error('Unknown encoding: ' + f);
        return p || f;
      })(h)),
      this.encoding)
    ) {
      case 'utf16le':
        (this.text = i), (this.end = o), (d = 4);
        break;
      case 'utf8':
        (this.fillLast = a), (d = 4);
        break;
      case 'base64':
        (this.text = s), (this.end = u), (d = 3);
        break;
      default:
        return (this.write = l), void (this.end = c);
    }
    (this.lastNeed = 0), (this.lastTotal = 0), (this.lastChar = r.allocUnsafe(d));
  }
  function n(h) {
    return h <= 127 ? 0 : h >> 5 == 6 ? 2 : h >> 4 == 14 ? 3 : h >> 3 == 30 ? 4 : h >> 6 == 2 ? -1 : -2;
  }
  function a(h) {
    var d = this.lastTotal - this.lastNeed,
      f = (function (p, v) {
        if ((192 & v[0]) != 128) return (p.lastNeed = 0), '�';
        if (p.lastNeed > 1 && v.length > 1) {
          if ((192 & v[1]) != 128) return (p.lastNeed = 1), '�';
          if (p.lastNeed > 2 && v.length > 2 && (192 & v[2]) != 128) return (p.lastNeed = 2), '�';
        }
      })(this, h);
    return f !== void 0
      ? f
      : this.lastNeed <= h.length
      ? (h.copy(this.lastChar, d, 0, this.lastNeed), this.lastChar.toString(this.encoding, 0, this.lastTotal))
      : (h.copy(this.lastChar, d, 0, h.length), void (this.lastNeed -= h.length));
  }
  function i(h, d) {
    if ((h.length - d) % 2 == 0) {
      var f = h.toString('utf16le', d);
      if (f) {
        var p = f.charCodeAt(f.length - 1);
        if (p >= 55296 && p <= 56319)
          return (
            (this.lastNeed = 2),
            (this.lastTotal = 4),
            (this.lastChar[0] = h[h.length - 2]),
            (this.lastChar[1] = h[h.length - 1]),
            f.slice(0, -1)
          );
      }
      return f;
    }
    return (
      (this.lastNeed = 1),
      (this.lastTotal = 2),
      (this.lastChar[0] = h[h.length - 1]),
      h.toString('utf16le', d, h.length - 1)
    );
  }
  function o(h) {
    var d = h && h.length ? this.write(h) : '';
    if (this.lastNeed) {
      var f = this.lastTotal - this.lastNeed;
      return d + this.lastChar.toString('utf16le', 0, f);
    }
    return d;
  }
  function s(h, d) {
    var f = (h.length - d) % 3;
    return f === 0
      ? h.toString('base64', d)
      : ((this.lastNeed = 3 - f),
        (this.lastTotal = 3),
        f === 1
          ? (this.lastChar[0] = h[h.length - 1])
          : ((this.lastChar[0] = h[h.length - 2]), (this.lastChar[1] = h[h.length - 1])),
        h.toString('base64', d, h.length - f));
  }
  function u(h) {
    var d = h && h.length ? this.write(h) : '';
    return this.lastNeed ? d + this.lastChar.toString('base64', 0, 3 - this.lastNeed) : d;
  }
  function l(h) {
    return h.toString(this.encoding);
  }
  function c(h) {
    return h && h.length ? this.write(h) : '';
  }
  return (
    (as.StringDecoder = e),
    (e.prototype.write = function (h) {
      if (h.length === 0) return '';
      var d, f;
      if (this.lastNeed) {
        if ((d = this.fillLast(h)) === void 0) return '';
        (f = this.lastNeed), (this.lastNeed = 0);
      } else f = 0;
      return f < h.length ? (d ? d + this.text(h, f) : this.text(h, f)) : d || '';
    }),
    (e.prototype.end = function (h) {
      var d = h && h.length ? this.write(h) : '';
      return this.lastNeed ? d + '�' : d;
    }),
    (e.prototype.text = function (h, d) {
      var f = (function (v, y, E) {
        var _ = y.length - 1;
        if (_ < E) return 0;
        var g = n(y[_]);
        return g >= 0
          ? (g > 0 && (v.lastNeed = g - 1), g)
          : --_ < E || g === -2
          ? 0
          : ((g = n(y[_])),
            g >= 0
              ? (g > 0 && (v.lastNeed = g - 2), g)
              : --_ < E || g === -2
              ? 0
              : ((g = n(y[_])), g >= 0 ? (g > 0 && (g === 2 ? (g = 0) : (v.lastNeed = g - 3)), g) : 0));
      })(this, h, d);
      if (!this.lastNeed) return h.toString('utf8', d);
      this.lastTotal = f;
      var p = h.length - (f - this.lastNeed);
      return h.copy(this.lastChar, 0, p), h.toString('utf8', d, p);
    }),
    (e.prototype.fillLast = function (h) {
      if (this.lastNeed <= h.length)
        return (
          h.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed),
          this.lastChar.toString(this.encoding, 0, this.lastTotal)
        );
      h.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, h.length), (this.lastNeed -= h.length);
    }),
    as
  );
}
function qm() {
  if (Fp) return rs;
  Fp = 1;
  var r = da();
  rs = v;
  var t,
    e = (function () {
      if (bp) return gp;
      bp = 1;
      var k = {}.toString;
      return (gp =
        Array.isArray ||
        function (m) {
          return k.call(m) == '[object Array]';
        });
    })();
  (v.ReadableState = p), ft.EventEmitter;
  var n = function (m, R) {
      return m.listeners(R).length;
    },
    a = Nm(),
    i = pa().Buffer,
    o =
      (fr !== void 0 ? fr : typeof window < 'u' ? window : typeof self < 'u' ? self : {}).Uint8Array || function () {},
    s = Object.create(xn());
  s.inherits = Pn();
  var u = ft,
    l = void 0;
  l = u && u.debuglog ? u.debuglog('stream') : function () {};
  var c,
    h = r_(),
    d = Mm();
  s.inherits(v, a);
  var f = ['error', 'close', 'destroy', 'pause', 'resume'];
  function p(k, m) {
    k = k || {};
    var R = m instanceof (t = t || Ut());
    (this.objectMode = !!k.objectMode), R && (this.objectMode = this.objectMode || !!k.readableObjectMode);
    var I = k.highWaterMark,
      M = k.readableHighWaterMark,
      U = this.objectMode ? 16 : 16384;
    (this.highWaterMark = I || I === 0 ? I : R && (M || M === 0) ? M : U),
      (this.highWaterMark = Math.floor(this.highWaterMark)),
      (this.buffer = new h()),
      (this.length = 0),
      (this.pipes = null),
      (this.pipesCount = 0),
      (this.flowing = null),
      (this.ended = !1),
      (this.endEmitted = !1),
      (this.reading = !1),
      (this.sync = !0),
      (this.needReadable = !1),
      (this.emittedReadable = !1),
      (this.readableListening = !1),
      (this.resumeScheduled = !1),
      (this.destroyed = !1),
      (this.defaultEncoding = k.defaultEncoding || 'utf8'),
      (this.awaitDrain = 0),
      (this.readingMore = !1),
      (this.decoder = null),
      (this.encoding = null),
      k.encoding && (c || (c = jp().StringDecoder), (this.decoder = new c(k.encoding)), (this.encoding = k.encoding));
  }
  function v(k) {
    if (((t = t || Ut()), !(this instanceof v))) return new v(k);
    (this._readableState = new p(k, this)),
      (this.readable = !0),
      k &&
        (typeof k.read == 'function' && (this._read = k.read),
        typeof k.destroy == 'function' && (this._destroy = k.destroy)),
      a.call(this);
  }
  function y(k, m, R, I, M) {
    var U,
      N = k._readableState;
    return (
      m === null
        ? ((N.reading = !1),
          (function (Z, ne) {
            if (!ne.ended) {
              if (ne.decoder) {
                var oe = ne.decoder.end();
                oe && oe.length && (ne.buffer.push(oe), (ne.length += ne.objectMode ? 1 : oe.length));
              }
              (ne.ended = !0), b(Z);
            }
          })(k, N))
        : (M ||
            (U = (function (Z, ne) {
              var oe;
              (fe = ne),
                i.isBuffer(fe) ||
                  fe instanceof o ||
                  typeof ne == 'string' ||
                  ne === void 0 ||
                  Z.objectMode ||
                  (oe = new TypeError('Invalid non-string/buffer chunk'));
              var fe;
              return oe;
            })(N, m)),
          U
            ? k.emit('error', U)
            : N.objectMode || (m && m.length > 0)
            ? (typeof m == 'string' ||
                N.objectMode ||
                Object.getPrototypeOf(m) === i.prototype ||
                (m = (function (Z) {
                  return i.from(Z);
                })(m)),
              I
                ? N.endEmitted
                  ? k.emit('error', new Error('stream.unshift() after end event'))
                  : E(k, N, m, !0)
                : N.ended
                ? k.emit('error', new Error('stream.push() after EOF'))
                : ((N.reading = !1),
                  N.decoder && !R
                    ? ((m = N.decoder.write(m)), N.objectMode || m.length !== 0 ? E(k, N, m, !1) : w(k, N))
                    : E(k, N, m, !1)))
            : I || (N.reading = !1)),
      (function (Z) {
        return !Z.ended && (Z.needReadable || Z.length < Z.highWaterMark || Z.length === 0);
      })(N)
    );
  }
  function E(k, m, R, I) {
    m.flowing && m.length === 0 && !m.sync
      ? (k.emit('data', R), k.read(0))
      : ((m.length += m.objectMode ? 1 : R.length), I ? m.buffer.unshift(R) : m.buffer.push(R), m.needReadable && b(k)),
      w(k, m);
  }
  Object.defineProperty(v.prototype, 'destroyed', {
    get: function () {
      return this._readableState !== void 0 && this._readableState.destroyed;
    },
    set: function (m) {
      this._readableState && (this._readableState.destroyed = m);
    },
  }),
    (v.prototype.destroy = d.destroy),
    (v.prototype._undestroy = d.undestroy),
    (v.prototype._destroy = function (k, m) {
      this.push(null), m(k);
    }),
    (v.prototype.push = function (k, m) {
      var R,
        I = this._readableState;
      return (
        I.objectMode
          ? (R = !0)
          : typeof k == 'string' &&
            ((m = m || I.defaultEncoding) !== I.encoding && ((k = i.from(k, m)), (m = '')), (R = !0)),
        y(this, k, m, !1, R)
      );
    }),
    (v.prototype.unshift = function (k) {
      return y(this, k, null, !0, !1);
    }),
    (v.prototype.isPaused = function () {
      return this._readableState.flowing === !1;
    }),
    (v.prototype.setEncoding = function (k) {
      return (
        c || (c = jp().StringDecoder),
        (this._readableState.decoder = new c(k)),
        (this._readableState.encoding = k),
        this
      );
    });
  var _ = 8388608;
  function g(k, m) {
    return k <= 0 || (m.length === 0 && m.ended)
      ? 0
      : m.objectMode
      ? 1
      : k != k
      ? m.flowing && m.length
        ? m.buffer.head.data.length
        : m.length
      : (k > m.highWaterMark &&
          (m.highWaterMark = (function (R) {
            return (
              R >= _
                ? (R = _)
                : (R--, (R |= R >>> 1), (R |= R >>> 2), (R |= R >>> 4), (R |= R >>> 8), (R |= R >>> 16), R++),
              R
            );
          })(k)),
        k <= m.length ? k : m.ended ? m.length : ((m.needReadable = !0), 0));
  }
  function b(k) {
    var m = k._readableState;
    (m.needReadable = !1),
      m.emittedReadable || (l('emitReadable', m.flowing), (m.emittedReadable = !0), m.sync ? r.nextTick(A, k) : A(k));
  }
  function A(k) {
    l('emit readable'), k.emit('readable'), C(k);
  }
  function w(k, m) {
    m.readingMore || ((m.readingMore = !0), r.nextTick(T, k, m));
  }
  function T(k, m) {
    for (
      var R = m.length;
      !m.reading &&
      !m.flowing &&
      !m.ended &&
      m.length < m.highWaterMark &&
      (l('maybeReadMore read 0'), k.read(0), R !== m.length);

    )
      R = m.length;
    m.readingMore = !1;
  }
  function P(k) {
    l('readable nexttick read 0'), k.read(0);
  }
  function x(k, m) {
    m.reading || (l('resume read 0'), k.read(0)),
      (m.resumeScheduled = !1),
      (m.awaitDrain = 0),
      k.emit('resume'),
      C(k),
      m.flowing && !m.reading && k.read(0);
  }
  function C(k) {
    var m = k._readableState;
    for (l('flow', m.flowing); m.flowing && k.read() !== null; );
  }
  function q(k, m) {
    return m.length === 0
      ? null
      : (m.objectMode
          ? (R = m.buffer.shift())
          : !k || k >= m.length
          ? ((R = m.decoder
              ? m.buffer.join('')
              : m.buffer.length === 1
              ? m.buffer.head.data
              : m.buffer.concat(m.length)),
            m.buffer.clear())
          : (R = (function (I, M, U) {
              var N;
              return (
                I < M.head.data.length
                  ? ((N = M.head.data.slice(0, I)), (M.head.data = M.head.data.slice(I)))
                  : (N =
                      I === M.head.data.length
                        ? M.shift()
                        : U
                        ? (function (Z, ne) {
                            var oe = ne.head,
                              fe = 1,
                              Y = oe.data;
                            for (Z -= Y.length; (oe = oe.next); ) {
                              var z = oe.data,
                                Q = Z > z.length ? z.length : Z;
                              if ((Q === z.length ? (Y += z) : (Y += z.slice(0, Z)), (Z -= Q) === 0)) {
                                Q === z.length
                                  ? (++fe, oe.next ? (ne.head = oe.next) : (ne.head = ne.tail = null))
                                  : ((ne.head = oe), (oe.data = z.slice(Q)));
                                break;
                              }
                              ++fe;
                            }
                            return (ne.length -= fe), Y;
                          })(I, M)
                        : (function (Z, ne) {
                            var oe = i.allocUnsafe(Z),
                              fe = ne.head,
                              Y = 1;
                            for (fe.data.copy(oe), Z -= fe.data.length; (fe = fe.next); ) {
                              var z = fe.data,
                                Q = Z > z.length ? z.length : Z;
                              if ((z.copy(oe, oe.length - Z, 0, Q), (Z -= Q) === 0)) {
                                Q === z.length
                                  ? (++Y, fe.next ? (ne.head = fe.next) : (ne.head = ne.tail = null))
                                  : ((ne.head = fe), (fe.data = z.slice(Q)));
                                break;
                              }
                              ++Y;
                            }
                            return (ne.length -= Y), oe;
                          })(I, M)),
                N
              );
            })(k, m.buffer, m.decoder)),
        R);
    var R;
  }
  function L(k) {
    var m = k._readableState;
    if (m.length > 0) throw new Error('"endReadable()" called on non-empty stream');
    m.endEmitted || ((m.ended = !0), r.nextTick(ae, m, k));
  }
  function ae(k, m) {
    k.endEmitted || k.length !== 0 || ((k.endEmitted = !0), (m.readable = !1), m.emit('end'));
  }
  function te(k, m) {
    for (var R = 0, I = k.length; R < I; R++) if (k[R] === m) return R;
    return -1;
  }
  return (
    (v.prototype.read = function (k) {
      l('read', k), (k = parseInt(k, 10));
      var m = this._readableState,
        R = k;
      if ((k !== 0 && (m.emittedReadable = !1), k === 0 && m.needReadable && (m.length >= m.highWaterMark || m.ended)))
        return l('read: emitReadable', m.length, m.ended), m.length === 0 && m.ended ? L(this) : b(this), null;
      if ((k = g(k, m)) === 0 && m.ended) return m.length === 0 && L(this), null;
      var I,
        M = m.needReadable;
      return (
        l('need readable', M),
        (m.length === 0 || m.length - k < m.highWaterMark) && l('length less than watermark', (M = !0)),
        m.ended || m.reading
          ? l('reading or ended', (M = !1))
          : M &&
            (l('do read'),
            (m.reading = !0),
            (m.sync = !0),
            m.length === 0 && (m.needReadable = !0),
            this._read(m.highWaterMark),
            (m.sync = !1),
            m.reading || (k = g(R, m))),
        (I = k > 0 ? q(k, m) : null) === null ? ((m.needReadable = !0), (k = 0)) : (m.length -= k),
        m.length === 0 && (m.ended || (m.needReadable = !0), R !== k && m.ended && L(this)),
        I !== null && this.emit('data', I),
        I
      );
    }),
    (v.prototype._read = function (k) {
      this.emit('error', new Error('_read() is not implemented'));
    }),
    (v.prototype.pipe = function (k, m) {
      var R = this,
        I = this._readableState;
      switch (I.pipesCount) {
        case 0:
          I.pipes = k;
          break;
        case 1:
          I.pipes = [I.pipes, k];
          break;
        default:
          I.pipes.push(k);
      }
      (I.pipesCount += 1), l('pipe count=%d opts=%j', I.pipesCount, m);
      var M = (!m || m.end !== !1) && k !== process.stdout && k !== process.stderr ? N : ue;
      function U(G, ie) {
        l('onunpipe'),
          G === R &&
            ie &&
            ie.hasUnpiped === !1 &&
            ((ie.hasUnpiped = !0),
            l('cleanup'),
            k.removeListener('close', z),
            k.removeListener('finish', Q),
            k.removeListener('drain', Z),
            k.removeListener('error', Y),
            k.removeListener('unpipe', U),
            R.removeListener('end', N),
            R.removeListener('end', ue),
            R.removeListener('data', fe),
            (ne = !0),
            !I.awaitDrain || (k._writableState && !k._writableState.needDrain) || Z());
      }
      function N() {
        l('onend'), k.end();
      }
      I.endEmitted ? r.nextTick(M) : R.once('end', M), k.on('unpipe', U);
      var Z = (function (G) {
        return function () {
          var ie = G._readableState;
          l('pipeOnDrain', ie.awaitDrain),
            ie.awaitDrain && ie.awaitDrain--,
            ie.awaitDrain === 0 && n(G, 'data') && ((ie.flowing = !0), C(G));
        };
      })(R);
      k.on('drain', Z);
      var ne = !1,
        oe = !1;
      function fe(G) {
        l('ondata'),
          (oe = !1),
          k.write(G) !== !1 ||
            oe ||
            (((I.pipesCount === 1 && I.pipes === k) || (I.pipesCount > 1 && te(I.pipes, k) !== -1)) &&
              !ne &&
              (l('false write response, pause', I.awaitDrain), I.awaitDrain++, (oe = !0)),
            R.pause());
      }
      function Y(G) {
        l('onerror', G), ue(), k.removeListener('error', Y), n(k, 'error') === 0 && k.emit('error', G);
      }
      function z() {
        k.removeListener('finish', Q), ue();
      }
      function Q() {
        l('onfinish'), k.removeListener('close', z), ue();
      }
      function ue() {
        l('unpipe'), R.unpipe(k);
      }
      return (
        R.on('data', fe),
        (function (G, ie, K) {
          if (typeof G.prependListener == 'function') return G.prependListener(ie, K);
          G._events && G._events[ie]
            ? e(G._events[ie])
              ? G._events[ie].unshift(K)
              : (G._events[ie] = [K, G._events[ie]])
            : G.on(ie, K);
        })(k, 'error', Y),
        k.once('close', z),
        k.once('finish', Q),
        k.emit('pipe', R),
        I.flowing || (l('pipe resume'), R.resume()),
        k
      );
    }),
    (v.prototype.unpipe = function (k) {
      var m = this._readableState,
        R = { hasUnpiped: !1 };
      if (m.pipesCount === 0) return this;
      if (m.pipesCount === 1)
        return (
          (k && k !== m.pipes) ||
            (k || (k = m.pipes),
            (m.pipes = null),
            (m.pipesCount = 0),
            (m.flowing = !1),
            k && k.emit('unpipe', this, R)),
          this
        );
      if (!k) {
        var I = m.pipes,
          M = m.pipesCount;
        (m.pipes = null), (m.pipesCount = 0), (m.flowing = !1);
        for (var U = 0; U < M; U++) I[U].emit('unpipe', this, { hasUnpiped: !1 });
        return this;
      }
      var N = te(m.pipes, k);
      return (
        N === -1 ||
          (m.pipes.splice(N, 1),
          (m.pipesCount -= 1),
          m.pipesCount === 1 && (m.pipes = m.pipes[0]),
          k.emit('unpipe', this, R)),
        this
      );
    }),
    (v.prototype.on = function (k, m) {
      var R = a.prototype.on.call(this, k, m);
      if (k === 'data') this._readableState.flowing !== !1 && this.resume();
      else if (k === 'readable') {
        var I = this._readableState;
        I.endEmitted ||
          I.readableListening ||
          ((I.readableListening = I.needReadable = !0),
          (I.emittedReadable = !1),
          I.reading ? I.length && b(this) : r.nextTick(P, this));
      }
      return R;
    }),
    (v.prototype.addListener = v.prototype.on),
    (v.prototype.resume = function () {
      var k = this._readableState;
      return (
        k.flowing ||
          (l('resume'),
          (k.flowing = !0),
          (function (m, R) {
            R.resumeScheduled || ((R.resumeScheduled = !0), r.nextTick(x, m, R));
          })(this, k)),
        this
      );
    }),
    (v.prototype.pause = function () {
      return (
        l('call pause flowing=%j', this._readableState.flowing),
        this._readableState.flowing !== !1 && (l('pause'), (this._readableState.flowing = !1), this.emit('pause')),
        this
      );
    }),
    (v.prototype.wrap = function (k) {
      var m = this,
        R = this._readableState,
        I = !1;
      for (var M in (k.on('end', function () {
        if ((l('wrapped end'), R.decoder && !R.ended)) {
          var N = R.decoder.end();
          N && N.length && m.push(N);
        }
        m.push(null);
      }),
      k.on('data', function (N) {
        l('wrapped data'),
          R.decoder && (N = R.decoder.write(N)),
          (R.objectMode && N == null) || ((R.objectMode || (N && N.length)) && (m.push(N) || ((I = !0), k.pause())));
      }),
      k))
        this[M] === void 0 &&
          typeof k[M] == 'function' &&
          (this[M] = (function (N) {
            return function () {
              return k[N].apply(k, arguments);
            };
          })(M));
      for (var U = 0; U < f.length; U++) k.on(f[U], this.emit.bind(this, f[U]));
      return (
        (this._read = function (N) {
          l('wrapped _read', N), I && ((I = !1), k.resume());
        }),
        this
      );
    }),
    Object.defineProperty(v.prototype, 'readableHighWaterMark', {
      enumerable: !1,
      get: function () {
        return this._readableState.highWaterMark;
      },
    }),
    (v._fromList = q),
    rs
  );
}
function Lp() {
  if (qp) return ts;
  (qp = 1), (ts = n);
  var r = Ut(),
    t = Object.create(xn());
  function e(o, s) {
    var u = this._transformState;
    u.transforming = !1;
    var l = u.writecb;
    if (!l) return this.emit('error', new Error('write callback called multiple times'));
    (u.writechunk = null), (u.writecb = null), s != null && this.push(s), l(o);
    var c = this._readableState;
    (c.reading = !1), (c.needReadable || c.length < c.highWaterMark) && this._read(c.highWaterMark);
  }
  function n(o) {
    if (!(this instanceof n)) return new n(o);
    r.call(this, o),
      (this._transformState = {
        afterTransform: e.bind(this),
        needTransform: !1,
        transforming: !1,
        writecb: null,
        writechunk: null,
        writeencoding: null,
      }),
      (this._readableState.needReadable = !0),
      (this._readableState.sync = !1),
      o &&
        (typeof o.transform == 'function' && (this._transform = o.transform),
        typeof o.flush == 'function' && (this._flush = o.flush)),
      this.on('prefinish', a);
  }
  function a() {
    var o = this;
    typeof this._flush == 'function'
      ? this._flush(function (s, u) {
          i(o, s, u);
        })
      : i(this, null, null);
  }
  function i(o, s, u) {
    if (s) return o.emit('error', s);
    if ((u != null && o.push(u), o._writableState.length))
      throw new Error('Calling transform done when ws.length != 0');
    if (o._transformState.transforming) throw new Error('Calling transform done when still transforming');
    return o.push(null);
  }
  return (
    (t.inherits = Pn()),
    t.inherits(n, r),
    (n.prototype.push = function (o, s) {
      return (this._transformState.needTransform = !1), r.prototype.push.call(this, o, s);
    }),
    (n.prototype._transform = function (o, s, u) {
      throw new Error('_transform() is not implemented');
    }),
    (n.prototype._write = function (o, s, u) {
      var l = this._transformState;
      if (((l.writecb = u), (l.writechunk = o), (l.writeencoding = s), !l.transforming)) {
        var c = this._readableState;
        (l.needTransform || c.needReadable || c.length < c.highWaterMark) && this._read(c.highWaterMark);
      }
    }),
    (n.prototype._read = function (o) {
      var s = this._transformState;
      s.writechunk !== null && s.writecb && !s.transforming
        ? ((s.transforming = !0), this._transform(s.writechunk, s.writeencoding, s.afterTransform))
        : (s.needTransform = !0);
    }),
    (n.prototype._destroy = function (o, s) {
      var u = this;
      r.prototype._destroy.call(this, o, function (l) {
        s(l), u.emit('close');
      });
    }),
    ts
  );
}
function Bm() {
  return (
    Dp ||
      ((Dp = 1),
      (r = Zo),
      (t = Zo.exports),
      (e = ft),
      Hb.READABLE_STREAM === 'disable' && e
        ? ((r.exports = e),
          ((t = r.exports = e.Readable).Readable = e.Readable),
          (t.Writable = e.Writable),
          (t.Duplex = e.Duplex),
          (t.Transform = e.Transform),
          (t.PassThrough = e.PassThrough),
          (t.Stream = e))
        : (((t = r.exports = qm()).Stream = e || t),
          (t.Readable = t),
          (t.Writable = Fm()),
          (t.Duplex = Ut()),
          (t.Transform = Lp()),
          (t.PassThrough = (function () {
            if (Bp) return ns;
            (Bp = 1), (ns = i);
            var n = Lp(),
              a = Object.create(xn());
            function i(o) {
              if (!(this instanceof i)) return new i(o);
              n.call(this, o);
            }
            return (
              (a.inherits = Pn()),
              a.inherits(i, n),
              (i.prototype._transform = function (o, s, u) {
                u(null, o);
              }),
              ns
            );
          })()))),
    Zo.exports
  );
  var r, t, e;
}
if (
  ((Xe.base64 = !0),
  (Xe.array = !0),
  (Xe.string = !0),
  (Xe.arraybuffer = typeof ArrayBuffer < 'u' && typeof Uint8Array < 'u'),
  (Xe.nodebuffer = typeof Buffer < 'u'),
  (Xe.uint8array = typeof Uint8Array < 'u'),
  typeof ArrayBuffer > 'u')
)
  Xe.blob = !1;
else {
  var Up = new ArrayBuffer(0);
  try {
    Xe.blob = new Blob([Up], { type: 'application/zip' }).size === 0;
  } catch {
    try {
      var zp = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
      zp.append(Up), (Xe.blob = zp.getBlob('application/zip').size === 0);
    } catch {
      Xe.blob = !1;
    }
  }
}
try {
  Xe.nodestream = !!Bm().Readable;
} catch {
  Xe.nodestream = !1;
}
var Wp,
  qn = {};
function Dm() {
  if (Wp) return qn;
  Wp = 1;
  var r = We(),
    t = Xe,
    e = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  return (
    (qn.encode = function (n) {
      for (var a, i, o, s, u, l, c, h = [], d = 0, f = n.length, p = f, v = r.getTypeOf(n) !== 'string'; d < n.length; )
        (p = f - d),
          v
            ? ((a = n[d++]), (i = d < f ? n[d++] : 0), (o = d < f ? n[d++] : 0))
            : ((a = n.charCodeAt(d++)), (i = d < f ? n.charCodeAt(d++) : 0), (o = d < f ? n.charCodeAt(d++) : 0)),
          (s = a >> 2),
          (u = ((3 & a) << 4) | (i >> 4)),
          (l = p > 1 ? ((15 & i) << 2) | (o >> 6) : 64),
          (c = p > 2 ? 63 & o : 64),
          h.push(e.charAt(s) + e.charAt(u) + e.charAt(l) + e.charAt(c));
      return h.join('');
    }),
    (qn.decode = function (n) {
      var a,
        i,
        o,
        s,
        u,
        l,
        c = 0,
        h = 0,
        d = 'data:';
      if (n.substr(0, 5) === d) throw new Error('Invalid base64 input, it looks like a data url.');
      var f,
        p = (3 * (n = n.replace(/[^A-Za-z0-9+/=]/g, '')).length) / 4;
      if ((n.charAt(n.length - 1) === e.charAt(64) && p--, n.charAt(n.length - 2) === e.charAt(64) && p--, p % 1 != 0))
        throw new Error('Invalid base64 input, bad content length.');
      for (f = t.uint8array ? new Uint8Array(0 | p) : new Array(0 | p); c < n.length; )
        (a = (e.indexOf(n.charAt(c++)) << 2) | ((s = e.indexOf(n.charAt(c++))) >> 4)),
          (i = ((15 & s) << 4) | ((u = e.indexOf(n.charAt(c++))) >> 2)),
          (o = ((3 & u) << 6) | (l = e.indexOf(n.charAt(c++)))),
          (f[h++] = a),
          u !== 64 && (f[h++] = i),
          l !== 64 && (f[h++] = o);
      return f;
    }),
    qn
  );
}
var Hp,
  Gp,
  is,
  Vp,
  va = {
    isNode: typeof Buffer < 'u',
    newBufferFrom: function (t, e) {
      if (Buffer.from && Buffer.from !== Uint8Array.from) return Buffer.from(t, e);
      if (typeof t == 'number') throw new Error('The "data" argument must not be a number');
      return new Buffer(t, e);
    },
    allocBuffer: function (t) {
      if (Buffer.alloc) return Buffer.alloc(t);
      var e = new Buffer(t);
      return e.fill(0), e;
    },
    isBuffer: function (t) {
      return Buffer.isBuffer(t);
    },
    isStream: function (t) {
      return t && typeof t.on == 'function' && typeof t.pause == 'function' && typeof t.resume == 'function';
    },
  },
  jm = null;
jm =
  typeof Promise < 'u'
    ? Promise
    : (function () {
        if (Vp) return is;
        Vp = 1;
        var r = (function () {
          if (Gp) return Hp;
          Gp = 1;
          var f,
            p,
            v = fr.MutationObserver || fr.WebKitMutationObserver;
          if (process.browser)
            if (v) {
              var y = 0,
                E = new v(A),
                _ = fr.document.createTextNode('');
              E.observe(_, { characterData: !0 }),
                (f = function () {
                  _.data = y = ++y % 2;
                });
            } else if (fr.setImmediate || fr.MessageChannel === void 0)
              f =
                'document' in fr && 'onreadystatechange' in fr.document.createElement('script')
                  ? function () {
                      var w = fr.document.createElement('script');
                      (w.onreadystatechange = function () {
                        A(), (w.onreadystatechange = null), w.parentNode.removeChild(w), (w = null);
                      }),
                        fr.document.documentElement.appendChild(w);
                    }
                  : function () {
                      setTimeout(A, 0);
                    };
            else {
              var g = new fr.MessageChannel();
              (g.port1.onmessage = A),
                (f = function () {
                  g.port2.postMessage(0);
                });
            }
          else
            f = function () {
              process.nextTick(A);
            };
          var b = [];
          function A() {
            var w, T;
            p = !0;
            for (var P = b.length; P; ) {
              for (T = b, b = [], w = -1; ++w < P; ) T[w]();
              P = b.length;
            }
            p = !1;
          }
          return (Hp = function (T) {
            b.push(T) !== 1 || p || f();
          });
        })();
        function t() {}
        var e = {},
          n = ['REJECTED'],
          a = ['FULFILLED'],
          i = ['PENDING'];
        if (!process.browser) var o = ['UNHANDLED'];
        function s(f) {
          if (typeof f != 'function') throw new TypeError('resolver must be a function');
          (this.state = i),
            (this.queue = []),
            (this.outcome = void 0),
            process.browser || (this.handled = o),
            f !== t && h(this, f);
        }
        function u(f, p, v) {
          (this.promise = f),
            typeof p == 'function' && ((this.onFulfilled = p), (this.callFulfilled = this.otherCallFulfilled)),
            typeof v == 'function' && ((this.onRejected = v), (this.callRejected = this.otherCallRejected));
        }
        function l(f, p, v) {
          r(function () {
            var y;
            try {
              y = p(v);
            } catch (E) {
              return e.reject(f, E);
            }
            y === f ? e.reject(f, new TypeError('Cannot resolve promise with itself')) : e.resolve(f, y);
          });
        }
        function c(f) {
          var p = f && f.then;
          if (f && (yr(f) == 'object' || typeof f == 'function') && typeof p == 'function')
            return function () {
              p.apply(f, arguments);
            };
        }
        function h(f, p) {
          var v = !1;
          function y(g) {
            v || ((v = !0), e.reject(f, g));
          }
          function E(g) {
            v || ((v = !0), e.resolve(f, g));
          }
          var _ = d(function () {
            p(E, y);
          });
          _.status === 'error' && y(_.value);
        }
        function d(f, p) {
          var v = {};
          try {
            (v.value = f(p)), (v.status = 'success');
          } catch (y) {
            (v.status = 'error'), (v.value = y);
          }
          return v;
        }
        return (
          (is = s),
          (s.prototype.finally = function (f) {
            if (typeof f != 'function') return this;
            var p = this.constructor;
            return this.then(
              function (v) {
                return p.resolve(f()).then(function () {
                  return v;
                });
              },
              function (v) {
                return p.resolve(f()).then(function () {
                  throw v;
                });
              }
            );
          }),
          (s.prototype.catch = function (f) {
            return this.then(null, f);
          }),
          (s.prototype.then = function (f, p) {
            if ((typeof f != 'function' && this.state === a) || (typeof p != 'function' && this.state === n))
              return this;
            var v = new this.constructor(t);
            return (
              process.browser || (this.handled === o && (this.handled = null)),
              this.state !== i ? l(v, this.state === a ? f : p, this.outcome) : this.queue.push(new u(v, f, p)),
              v
            );
          }),
          (u.prototype.callFulfilled = function (f) {
            e.resolve(this.promise, f);
          }),
          (u.prototype.otherCallFulfilled = function (f) {
            l(this.promise, this.onFulfilled, f);
          }),
          (u.prototype.callRejected = function (f) {
            e.reject(this.promise, f);
          }),
          (u.prototype.otherCallRejected = function (f) {
            l(this.promise, this.onRejected, f);
          }),
          (e.resolve = function (f, p) {
            var v = d(c, p);
            if (v.status === 'error') return e.reject(f, v.value);
            var y = v.value;
            if (y) h(f, y);
            else {
              (f.state = a), (f.outcome = p);
              for (var E = -1, _ = f.queue.length; ++E < _; ) f.queue[E].callFulfilled(p);
            }
            return f;
          }),
          (e.reject = function (f, p) {
            (f.state = n),
              (f.outcome = p),
              process.browser ||
                (f.handled === o &&
                  r(function () {
                    f.handled === o && process.emit('unhandledRejection', p, f);
                  }));
            for (var v = -1, y = f.queue.length; ++v < y; ) f.queue[v].callRejected(p);
            return f;
          }),
          (s.resolve = function (f) {
            return f instanceof this ? f : e.resolve(new this(t), f);
          }),
          (s.reject = function (f) {
            var p = new this(t);
            return e.reject(p, f);
          }),
          (s.all = function (f) {
            var p = this;
            if (Object.prototype.toString.call(f) !== '[object Array]')
              return this.reject(new TypeError('must be an array'));
            var v = f.length,
              y = !1;
            if (!v) return this.resolve([]);
            for (var E = new Array(v), _ = 0, g = -1, b = new this(t); ++g < v; ) A(f[g], g);
            return b;
            function A(w, T) {
              p.resolve(w).then(
                function (P) {
                  (E[T] = P), ++_ !== v || y || ((y = !0), e.resolve(b, E));
                },
                function (P) {
                  y || ((y = !0), e.reject(b, P));
                }
              );
            }
          }),
          (s.race = function (f) {
            var p = this;
            if (Object.prototype.toString.call(f) !== '[object Array]')
              return this.reject(new TypeError('must be an array'));
            var v = f.length,
              y = !1;
            if (!v) return this.resolve([]);
            for (var E, _ = -1, g = new this(t); ++_ < v; )
              (E = f[_]),
                p.resolve(E).then(
                  function (b) {
                    y || ((y = !0), e.resolve(g, b));
                  },
                  function (b) {
                    y || ((y = !0), e.reject(g, b));
                  }
                );
            return g;
          }),
          is
        );
      })();
var $p,
  In = { Promise: jm };
function We() {
  return (
    $p ||
      (($p = 1),
      (function (r) {
        var t = Xe,
          e = Dm(),
          n = va,
          a = In;
        function i(h) {
          return h;
        }
        function o(h, d) {
          for (var f = 0; f < h.length; ++f) d[f] = 255 & h.charCodeAt(f);
          return d;
        }
        r.newBlob = function (h, d) {
          r.checkSupport('blob');
          try {
            return new Blob([h], { type: d });
          } catch {
            try {
              var f = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
              return f.append(h), f.getBlob(d);
            } catch {
              throw new Error("Bug : can't construct the Blob.");
            }
          }
        };
        var s = {
          stringifyByChunk: function (d, f, p) {
            var v = [],
              y = 0,
              E = d.length;
            if (E <= p) return String.fromCharCode.apply(null, d);
            for (; y < E; )
              f === 'array' || f === 'nodebuffer'
                ? v.push(String.fromCharCode.apply(null, d.slice(y, Math.min(y + p, E))))
                : v.push(String.fromCharCode.apply(null, d.subarray(y, Math.min(y + p, E)))),
                (y += p);
            return v.join('');
          },
          stringifyByChar: function (d) {
            for (var f = '', p = 0; p < d.length; p++) f += String.fromCharCode(d[p]);
            return f;
          },
          applyCanBeUsed: {
            uint8array: (function () {
              try {
                return t.uint8array && String.fromCharCode.apply(null, new Uint8Array(1)).length === 1;
              } catch {
                return !1;
              }
            })(),
            nodebuffer: (function () {
              try {
                return t.nodebuffer && String.fromCharCode.apply(null, n.allocBuffer(1)).length === 1;
              } catch {
                return !1;
              }
            })(),
          },
        };
        function u(h) {
          var d = 65536,
            f = r.getTypeOf(h),
            p = !0;
          if (
            (f === 'uint8array'
              ? (p = s.applyCanBeUsed.uint8array)
              : f === 'nodebuffer' && (p = s.applyCanBeUsed.nodebuffer),
            p)
          )
            for (; d > 1; )
              try {
                return s.stringifyByChunk(h, f, d);
              } catch {
                d = Math.floor(d / 2);
              }
          return s.stringifyByChar(h);
        }
        function l(h, d) {
          for (var f = 0; f < h.length; f++) d[f] = h[f];
          return d;
        }
        r.applyFromCharCode = u;
        var c = {};
        (c.string = {
          string: i,
          array: function (d) {
            return o(d, new Array(d.length));
          },
          arraybuffer: function (d) {
            return c.string.uint8array(d).buffer;
          },
          uint8array: function (d) {
            return o(d, new Uint8Array(d.length));
          },
          nodebuffer: function (d) {
            return o(d, n.allocBuffer(d.length));
          },
        }),
          (c.array = {
            string: u,
            array: i,
            arraybuffer: function (d) {
              return new Uint8Array(d).buffer;
            },
            uint8array: function (d) {
              return new Uint8Array(d);
            },
            nodebuffer: function (d) {
              return n.newBufferFrom(d);
            },
          }),
          (c.arraybuffer = {
            string: function (d) {
              return u(new Uint8Array(d));
            },
            array: function (d) {
              return l(new Uint8Array(d), new Array(d.byteLength));
            },
            arraybuffer: i,
            uint8array: function (d) {
              return new Uint8Array(d);
            },
            nodebuffer: function (d) {
              return n.newBufferFrom(new Uint8Array(d));
            },
          }),
          (c.uint8array = {
            string: u,
            array: function (d) {
              return l(d, new Array(d.length));
            },
            arraybuffer: function (d) {
              return d.buffer;
            },
            uint8array: i,
            nodebuffer: function (d) {
              return n.newBufferFrom(d);
            },
          }),
          (c.nodebuffer = {
            string: u,
            array: function (d) {
              return l(d, new Array(d.length));
            },
            arraybuffer: function (d) {
              return c.nodebuffer.uint8array(d).buffer;
            },
            uint8array: function (d) {
              return l(d, new Uint8Array(d.length));
            },
            nodebuffer: i,
          }),
          (r.transformTo = function (h, d) {
            if ((d || (d = ''), !h)) return d;
            r.checkSupport(h);
            var f = r.getTypeOf(d);
            return c[f][h](d);
          }),
          (r.resolve = function (h) {
            for (var d = h.split('/'), f = [], p = 0; p < d.length; p++) {
              var v = d[p];
              v === '.' || (v === '' && p !== 0 && p !== d.length - 1) || (v === '..' ? f.pop() : f.push(v));
            }
            return f.join('/');
          }),
          (r.getTypeOf = function (h) {
            return typeof h == 'string'
              ? 'string'
              : Object.prototype.toString.call(h) === '[object Array]'
              ? 'array'
              : t.nodebuffer && n.isBuffer(h)
              ? 'nodebuffer'
              : t.uint8array && h instanceof Uint8Array
              ? 'uint8array'
              : t.arraybuffer && h instanceof ArrayBuffer
              ? 'arraybuffer'
              : void 0;
          }),
          (r.checkSupport = function (h) {
            if (!t[h.toLowerCase()]) throw new Error(h + ' is not supported by this platform');
          }),
          (r.MAX_VALUE_16BITS = 65535),
          (r.MAX_VALUE_32BITS = -1),
          (r.pretty = function (h) {
            var d,
              f,
              p = '';
            for (f = 0; f < (h || '').length; f++)
              p += '\\x' + ((d = h.charCodeAt(f)) < 16 ? '0' : '') + d.toString(16).toUpperCase();
            return p;
          }),
          (r.delay = function (h, d, f) {
            setImmediate(function () {
              h.apply(f || null, d || []);
            });
          }),
          (r.inherits = function (h, d) {
            var f = function () {};
            (f.prototype = d.prototype), (h.prototype = new f());
          }),
          (r.extend = function () {
            var h,
              d,
              f = {};
            for (h = 0; h < arguments.length; h++)
              for (d in arguments[h])
                Object.prototype.hasOwnProperty.call(arguments[h], d) && f[d] === void 0 && (f[d] = arguments[h][d]);
            return f;
          }),
          (r.prepareContent = function (h, d, f, p, v) {
            return a.Promise.resolve(d)
              .then(function (y) {
                return t.blob &&
                  (y instanceof Blob ||
                    ['[object File]', '[object Blob]'].indexOf(Object.prototype.toString.call(y)) !== -1) &&
                  typeof FileReader < 'u'
                  ? new a.Promise(function (E, _) {
                      var g = new FileReader();
                      (g.onload = function (b) {
                        E(b.target.result);
                      }),
                        (g.onerror = function (b) {
                          _(b.target.error);
                        }),
                        g.readAsArrayBuffer(y);
                    })
                  : y;
              })
              .then(function (y) {
                var E,
                  _ = r.getTypeOf(y);
                return _
                  ? (_ === 'arraybuffer'
                      ? (y = r.transformTo('uint8array', y))
                      : _ === 'string' &&
                        (v
                          ? (y = e.decode(y))
                          : f &&
                            p !== !0 &&
                            (y = o((E = y), t.uint8array ? new Uint8Array(E.length) : new Array(E.length)))),
                    y)
                  : a.Promise.reject(
                      new Error(
                        "Can't read the data of '" +
                          h +
                          "'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"
                      )
                    );
              });
          });
      })(Sp)),
    Sp
  );
}
function Lm(r) {
  (this.name = r || 'default'),
    (this.streamInfo = {}),
    (this.generatedError = null),
    (this.extraStreamInfo = {}),
    (this.isPaused = !0),
    (this.isFinished = !1),
    (this.isLocked = !1),
    (this._listeners = { data: [], end: [], error: [] }),
    (this.previous = null);
}
(function (r) {
  if (!r.setImmediate) {
    var t,
      e,
      n,
      a,
      i,
      o = 1,
      s = {},
      u = !1,
      l = r.document,
      c = Object.getPrototypeOf && Object.getPrototypeOf(r);
    (c = c && c.setTimeout ? c : r),
      {}.toString.call(r.process) === '[object process]'
        ? (t = function (p) {
            process.nextTick(function () {
              d(p);
            });
          })
        : (function () {
            if (r.postMessage && !r.importScripts) {
              var f = !0,
                p = r.onmessage;
              return (
                (r.onmessage = function () {
                  f = !1;
                }),
                r.postMessage('', '*'),
                (r.onmessage = p),
                f
              );
            }
          })()
        ? ((a = 'setImmediate$' + Math.random() + '$'),
          (i = function (p) {
            p.source === r && typeof p.data == 'string' && p.data.indexOf(a) === 0 && d(+p.data.slice(a.length));
          }),
          r.addEventListener ? r.addEventListener('message', i, !1) : r.attachEvent('onmessage', i),
          (t = function (p) {
            r.postMessage(a + p, '*');
          }))
        : r.MessageChannel
        ? (((n = new MessageChannel()).port1.onmessage = function (f) {
            d(f.data);
          }),
          (t = function (p) {
            n.port2.postMessage(p);
          }))
        : l && 'onreadystatechange' in l.createElement('script')
        ? ((e = l.documentElement),
          (t = function (p) {
            var v = l.createElement('script');
            (v.onreadystatechange = function () {
              d(p), (v.onreadystatechange = null), e.removeChild(v), (v = null);
            }),
              e.appendChild(v);
          }))
        : (t = function (p) {
            setTimeout(d, 0, p);
          }),
      (c.setImmediate = function (f) {
        typeof f != 'function' && (f = new Function('' + f));
        for (var p = new Array(arguments.length - 1), v = 0; v < p.length; v++) p[v] = arguments[v + 1];
        var y = { callback: f, args: p };
        return (s[o] = y), t(o), o++;
      }),
      (c.clearImmediate = h);
  }
  function h(f) {
    delete s[f];
  }
  function d(f) {
    if (u) setTimeout(d, 0, f);
    else {
      var p = s[f];
      if (p) {
        u = !0;
        try {
          (function (v) {
            var y = v.callback,
              E = v.args;
            switch (E.length) {
              case 0:
                y();
                break;
              case 1:
                y(E[0]);
                break;
              case 2:
                y(E[0], E[1]);
                break;
              case 3:
                y(E[0], E[1], E[2]);
                break;
              default:
                y.apply(void 0, E);
            }
          })(p);
        } finally {
          h(f), (u = !1);
        }
      }
    }
  }
})(typeof self > 'u' ? fr : self),
  (Lm.prototype = {
    push: function (t) {
      this.emit('data', t);
    },
    end: function () {
      if (this.isFinished) return !1;
      this.flush();
      try {
        this.emit('end'), this.cleanUp(), (this.isFinished = !0);
      } catch (t) {
        this.emit('error', t);
      }
      return !0;
    },
    error: function (t) {
      return (
        !this.isFinished &&
        (this.isPaused
          ? (this.generatedError = t)
          : ((this.isFinished = !0), this.emit('error', t), this.previous && this.previous.error(t), this.cleanUp()),
        !0)
      );
    },
    on: function (t, e) {
      return this._listeners[t].push(e), this;
    },
    cleanUp: function () {
      (this.streamInfo = this.generatedError = this.extraStreamInfo = null), (this._listeners = []);
    },
    emit: function (t, e) {
      if (this._listeners[t]) for (var n = 0; n < this._listeners[t].length; n++) this._listeners[t][n].call(this, e);
    },
    pipe: function (t) {
      return t.registerPrevious(this);
    },
    registerPrevious: function (t) {
      if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
      (this.streamInfo = t.streamInfo), this.mergeStreamInfo(), (this.previous = t);
      var e = this;
      return (
        t.on('data', function (n) {
          e.processChunk(n);
        }),
        t.on('end', function () {
          e.end();
        }),
        t.on('error', function (n) {
          e.error(n);
        }),
        this
      );
    },
    pause: function () {
      return !this.isPaused && !this.isFinished && ((this.isPaused = !0), this.previous && this.previous.pause(), !0);
    },
    resume: function () {
      if (!this.isPaused || this.isFinished) return !1;
      this.isPaused = !1;
      var t = !1;
      return (
        this.generatedError && (this.error(this.generatedError), (t = !0)), this.previous && this.previous.resume(), !t
      );
    },
    flush: function () {},
    processChunk: function (t) {
      this.push(t);
    },
    withStreamInfo: function (t, e) {
      return (this.extraStreamInfo[t] = e), this.mergeStreamInfo(), this;
    },
    mergeStreamInfo: function () {
      for (var t in this.extraStreamInfo)
        Object.prototype.hasOwnProperty.call(this.extraStreamInfo, t) && (this.streamInfo[t] = this.extraStreamInfo[t]);
    },
    lock: function () {
      if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
      (this.isLocked = !0), this.previous && this.previous.lock();
    },
    toString: function () {
      var t = 'Worker ' + this.name;
      return this.previous ? this.previous + ' -> ' + t : t;
    },
  });
var Nr = Lm;
(function (r) {
  for (var t = We(), e = Xe, n = va, a = Nr, i = new Array(256), o = 0; o < 256; o++)
    i[o] = o >= 252 ? 6 : o >= 248 ? 5 : o >= 240 ? 4 : o >= 224 ? 3 : o >= 192 ? 2 : 1;
  i[254] = i[254] = 1;
  function s() {
    a.call(this, 'utf-8 decode'), (this.leftOver = null);
  }
  function u() {
    a.call(this, 'utf-8 encode');
  }
  (r.utf8encode = function (l) {
    return e.nodebuffer
      ? n.newBufferFrom(l, 'utf-8')
      : (function (c) {
          var h,
            d,
            f,
            p,
            v,
            y = c.length,
            E = 0;
          for (p = 0; p < y; p++)
            (64512 & (d = c.charCodeAt(p))) == 55296 &&
              p + 1 < y &&
              (64512 & (f = c.charCodeAt(p + 1))) == 56320 &&
              ((d = 65536 + ((d - 55296) << 10) + (f - 56320)), p++),
              (E += d < 128 ? 1 : d < 2048 ? 2 : d < 65536 ? 3 : 4);
          for (h = e.uint8array ? new Uint8Array(E) : new Array(E), v = 0, p = 0; v < E; p++)
            (64512 & (d = c.charCodeAt(p))) == 55296 &&
              p + 1 < y &&
              (64512 & (f = c.charCodeAt(p + 1))) == 56320 &&
              ((d = 65536 + ((d - 55296) << 10) + (f - 56320)), p++),
              d < 128
                ? (h[v++] = d)
                : d < 2048
                ? ((h[v++] = 192 | (d >>> 6)), (h[v++] = 128 | (63 & d)))
                : d < 65536
                ? ((h[v++] = 224 | (d >>> 12)), (h[v++] = 128 | ((d >>> 6) & 63)), (h[v++] = 128 | (63 & d)))
                : ((h[v++] = 240 | (d >>> 18)),
                  (h[v++] = 128 | ((d >>> 12) & 63)),
                  (h[v++] = 128 | ((d >>> 6) & 63)),
                  (h[v++] = 128 | (63 & d)));
          return h;
        })(l);
  }),
    (r.utf8decode = function (l) {
      return e.nodebuffer
        ? t.transformTo('nodebuffer', l).toString('utf-8')
        : (function (c) {
            var h,
              d,
              f,
              p,
              v = c.length,
              y = new Array(2 * v);
            for (d = 0, h = 0; h < v; )
              if ((f = c[h++]) < 128) y[d++] = f;
              else if ((p = i[f]) > 4) (y[d++] = 65533), (h += p - 1);
              else {
                for (f &= p === 2 ? 31 : p === 3 ? 15 : 7; p > 1 && h < v; ) (f = (f << 6) | (63 & c[h++])), p--;
                p > 1
                  ? (y[d++] = 65533)
                  : f < 65536
                  ? (y[d++] = f)
                  : ((f -= 65536), (y[d++] = 55296 | ((f >> 10) & 1023)), (y[d++] = 56320 | (1023 & f)));
              }
            return y.length !== d && (y.subarray ? (y = y.subarray(0, d)) : (y.length = d)), t.applyFromCharCode(y);
          })((l = t.transformTo(e.uint8array ? 'uint8array' : 'array', l)));
    }),
    t.inherits(s, a),
    (s.prototype.processChunk = function (l) {
      var c = t.transformTo(e.uint8array ? 'uint8array' : 'array', l.data);
      if (this.leftOver && this.leftOver.length) {
        if (e.uint8array) {
          var h = c;
          (c = new Uint8Array(h.length + this.leftOver.length)).set(this.leftOver, 0), c.set(h, this.leftOver.length);
        } else c = this.leftOver.concat(c);
        this.leftOver = null;
      }
      var d = (function (p, v) {
          var y;
          for ((v = v || p.length) > p.length && (v = p.length), y = v - 1; y >= 0 && (192 & p[y]) == 128; ) y--;
          return y < 0 || y === 0 ? v : y + i[p[y]] > v ? y : v;
        })(c),
        f = c;
      d !== c.length &&
        (e.uint8array
          ? ((f = c.subarray(0, d)), (this.leftOver = c.subarray(d, c.length)))
          : ((f = c.slice(0, d)), (this.leftOver = c.slice(d, c.length)))),
        this.push({ data: r.utf8decode(f), meta: l.meta });
    }),
    (s.prototype.flush = function () {
      this.leftOver &&
        this.leftOver.length &&
        (this.push({ data: r.utf8decode(this.leftOver), meta: {} }), (this.leftOver = null));
    }),
    (r.Utf8DecodeWorker = s),
    t.inherits(u, a),
    (u.prototype.processChunk = function (l) {
      this.push({ data: r.utf8encode(l.data), meta: l.meta });
    }),
    (r.Utf8EncodeWorker = u);
})(Kt);
var Um = Nr,
  Kp = We();
function Ts(r) {
  Um.call(this, 'ConvertWorker to ' + r), (this.destType = r);
}
Kp.inherits(Ts, Um),
  (Ts.prototype.processChunk = function (r) {
    this.push({ data: Kp.transformTo(this.destType, r.data), meta: r.meta });
  });
var Zp,
  Xp,
  t_ = Ts,
  At = We(),
  n_ = t_,
  a_ = Nr,
  i_ = Dm(),
  o_ = In,
  zm = null;
if (Xe.nodestream)
  try {
    zm = (function () {
      if (Xp) return Zp;
      Xp = 1;
      var r = Bm().Readable;
      function t(e, n, a) {
        r.call(this, n), (this._helper = e);
        var i = this;
        e.on('data', function (o, s) {
          i.push(o) || i._helper.pause(), a && a(s);
        })
          .on('error', function (o) {
            i.emit('error', o);
          })
          .on('end', function () {
            i.push(null);
          });
      }
      return (
        We().inherits(t, r),
        (t.prototype._read = function () {
          this._helper.resume();
        }),
        (Zp = t)
      );
    })();
  } catch {}
function s_(r, t) {
  return new o_.Promise(function (e, n) {
    var a = [],
      i = r._internalType,
      o = r._outputType,
      s = r._mimeType;
    r.on('data', function (u, l) {
      a.push(u), t && t(l);
    })
      .on('error', function (u) {
        (a = []), n(u);
      })
      .on('end', function () {
        try {
          var u = (function (l, c, h) {
            switch (l) {
              case 'blob':
                return At.newBlob(At.transformTo('arraybuffer', c), h);
              case 'base64':
                return i_.encode(c);
              default:
                return At.transformTo(l, c);
            }
          })(
            o,
            (function (l, c) {
              var h,
                d = 0,
                f = null,
                p = 0;
              for (h = 0; h < c.length; h++) p += c[h].length;
              switch (l) {
                case 'string':
                  return c.join('');
                case 'array':
                  return Array.prototype.concat.apply([], c);
                case 'uint8array':
                  for (f = new Uint8Array(p), h = 0; h < c.length; h++) f.set(c[h], d), (d += c[h].length);
                  return f;
                case 'nodebuffer':
                  return Buffer.concat(c);
                default:
                  throw new Error("concat : unsupported type '" + l + "'");
              }
            })(i, a),
            s
          );
          e(u);
        } catch (l) {
          n(l);
        }
        a = [];
      })
      .resume();
  });
}
function Wm(r, t, e) {
  var n = t;
  switch (t) {
    case 'blob':
    case 'arraybuffer':
      n = 'uint8array';
      break;
    case 'base64':
      n = 'string';
  }
  try {
    (this._internalType = n),
      (this._outputType = t),
      (this._mimeType = e),
      At.checkSupport(n),
      (this._worker = r.pipe(new n_(n))),
      r.lock();
  } catch (a) {
    (this._worker = new a_('error')), this._worker.error(a);
  }
}
Wm.prototype = {
  accumulate: function (t) {
    return s_(this, t);
  },
  on: function (t, e) {
    var n = this;
    return (
      t === 'data'
        ? this._worker.on(t, function (a) {
            e.call(n, a.data, a.meta);
          })
        : this._worker.on(t, function () {
            At.delay(e, arguments, n);
          }),
      this
    );
  },
  resume: function () {
    return At.delay(this._worker.resume, [], this._worker), this;
  },
  pause: function () {
    return this._worker.pause(), this;
  },
  toNodejsStream: function (t) {
    if ((At.checkSupport('nodestream'), this._outputType !== 'nodebuffer'))
      throw new Error(this._outputType + ' is not supported by this method');
    return new zm(this, { objectMode: this._outputType !== 'nodebuffer' }, t);
  },
};
var Hm = Wm,
  Gm = {
    base64: !1,
    binary: !1,
    dir: !1,
    createFolders: !0,
    date: null,
    compression: null,
    compressionOptions: null,
    comment: null,
    unixPermissions: null,
    dosPermissions: null,
  },
  Wn = We(),
  Hn = Nr;
function Nt(r) {
  Hn.call(this, 'DataWorker');
  var t = this;
  (this.dataIsReady = !1),
    (this.index = 0),
    (this.max = 0),
    (this.data = null),
    (this.type = ''),
    (this._tickScheduled = !1),
    r.then(
      function (e) {
        (t.dataIsReady = !0),
          (t.data = e),
          (t.max = (e && e.length) || 0),
          (t.type = Wn.getTypeOf(e)),
          t.isPaused || t._tickAndRepeat();
      },
      function (e) {
        t.error(e);
      }
    );
}
Wn.inherits(Nt, Hn),
  (Nt.prototype.cleanUp = function () {
    Hn.prototype.cleanUp.call(this), (this.data = null);
  }),
  (Nt.prototype.resume = function () {
    return (
      !!Hn.prototype.resume.call(this) &&
      (!this._tickScheduled &&
        this.dataIsReady &&
        ((this._tickScheduled = !0), Wn.delay(this._tickAndRepeat, [], this)),
      !0)
    );
  }),
  (Nt.prototype._tickAndRepeat = function () {
    (this._tickScheduled = !1),
      this.isPaused ||
        this.isFinished ||
        (this._tick(), this.isFinished || (Wn.delay(this._tickAndRepeat, [], this), (this._tickScheduled = !0)));
  }),
  (Nt.prototype._tick = function () {
    if (this.isPaused || this.isFinished) return !1;
    var r = null,
      t = Math.min(this.max, this.index + 16384);
    if (this.index >= this.max) return this.end();
    switch (this.type) {
      case 'string':
        r = this.data.substring(this.index, t);
        break;
      case 'uint8array':
        r = this.data.subarray(this.index, t);
        break;
      case 'array':
      case 'nodebuffer':
        r = this.data.slice(this.index, t);
    }
    return (this.index = t), this.push({ data: r, meta: { percent: this.max ? (this.index / this.max) * 100 : 0 } });
  });
var Vm = Nt,
  u_ = We(),
  Yp = (function () {
    for (var r, t = [], e = 0; e < 256; e++) {
      r = e;
      for (var n = 0; n < 8; n++) r = 1 & r ? 3988292384 ^ (r >>> 1) : r >>> 1;
      t[e] = r;
    }
    return t;
  })(),
  lu = function (t, e) {
    return t !== void 0 && t.length
      ? u_.getTypeOf(t) !== 'string'
        ? (function (n, a, i, o) {
            var s = Yp,
              u = o + i;
            n = ~n;
            for (var l = o; l < u; l++) n = (n >>> 8) ^ s[255 & (n ^ a[l])];
            return ~n;
          })(0 | e, t, t.length, 0)
        : (function (n, a, i, o) {
            var s = Yp,
              u = o + i;
            n = ~n;
            for (var l = o; l < u; l++) n = (n >>> 8) ^ s[255 & (n ^ a.charCodeAt(l))];
            return ~n;
          })(0 | e, t, t.length, 0)
      : 0;
  },
  $m = Nr,
  l_ = lu;
function xs() {
  $m.call(this, 'Crc32Probe'), this.withStreamInfo('crc32', 0);
}
We().inherits(xs, $m),
  (xs.prototype.processChunk = function (r) {
    (this.streamInfo.crc32 = l_(r.data, this.streamInfo.crc32 || 0)), this.push(r);
  });
var Km = xs,
  c_ = We(),
  Ps = Nr;
function Is(r) {
  Ps.call(this, 'DataLengthProbe for ' + r), (this.propName = r), this.withStreamInfo(r, 0);
}
c_.inherits(Is, Ps),
  (Is.prototype.processChunk = function (r) {
    if (r) {
      var t = this.streamInfo[this.propName] || 0;
      this.streamInfo[this.propName] = t + r.data.length;
    }
    Ps.prototype.processChunk.call(this, r);
  });
var Jp = In,
  Qp = Vm,
  f_ = Km,
  os = Is;
function Cs(r, t, e, n, a) {
  (this.compressedSize = r),
    (this.uncompressedSize = t),
    (this.crc32 = e),
    (this.compression = n),
    (this.compressedContent = a);
}
(Cs.prototype = {
  getContentWorker: function () {
    var t = new Qp(Jp.Promise.resolve(this.compressedContent))
        .pipe(this.compression.uncompressWorker())
        .pipe(new os('data_length')),
      e = this;
    return (
      t.on('end', function () {
        if (this.streamInfo.data_length !== e.uncompressedSize)
          throw new Error('Bug : uncompressed data size mismatch');
      }),
      t
    );
  },
  getCompressedWorker: function () {
    return new Qp(Jp.Promise.resolve(this.compressedContent))
      .withStreamInfo('compressedSize', this.compressedSize)
      .withStreamInfo('uncompressedSize', this.uncompressedSize)
      .withStreamInfo('crc32', this.crc32)
      .withStreamInfo('compression', this.compression);
  },
}),
  (Cs.createWorkerFrom = function (r, t, e) {
    return r
      .pipe(new f_())
      .pipe(new os('uncompressedSize'))
      .pipe(t.compressWorker(e))
      .pipe(new os('compressedSize'))
      .withStreamInfo('compression', t);
  });
var cu = Cs,
  h_ = Hm,
  d_ = Vm,
  ss = Kt,
  us = cu,
  ev = Nr,
  fu = function (t, e, n) {
    (this.name = t),
      (this.dir = n.dir),
      (this.date = n.date),
      (this.comment = n.comment),
      (this.unixPermissions = n.unixPermissions),
      (this.dosPermissions = n.dosPermissions),
      (this._data = e),
      (this._dataBinary = n.binary),
      (this.options = { compression: n.compression, compressionOptions: n.compressionOptions });
  };
fu.prototype = {
  internalStream: function (t) {
    var e = null,
      n = 'string';
    try {
      if (!t) throw new Error('No output type specified.');
      var a = (n = t.toLowerCase()) === 'string' || n === 'text';
      (n !== 'binarystring' && n !== 'text') || (n = 'string'), (e = this._decompressWorker());
      var i = !this._dataBinary;
      i && !a && (e = e.pipe(new ss.Utf8EncodeWorker())), !i && a && (e = e.pipe(new ss.Utf8DecodeWorker()));
    } catch (o) {
      (e = new ev('error')).error(o);
    }
    return new h_(e, n, '');
  },
  async: function (t, e) {
    return this.internalStream(t).accumulate(e);
  },
  nodeStream: function (t, e) {
    return this.internalStream(t || 'nodebuffer').toNodejsStream(e);
  },
  _compressWorker: function (t, e) {
    if (this._data instanceof us && this._data.compression.magic === t.magic) return this._data.getCompressedWorker();
    var n = this._decompressWorker();
    return this._dataBinary || (n = n.pipe(new ss.Utf8EncodeWorker())), us.createWorkerFrom(n, t, e);
  },
  _decompressWorker: function () {
    return this._data instanceof us
      ? this._data.getContentWorker()
      : this._data instanceof ev
      ? this._data
      : new d_(this._data);
  },
};
for (
  var rv = ['asText', 'asBinary', 'asNodeBuffer', 'asUint8Array', 'asArrayBuffer'],
    p_ = function () {
      throw new Error('This method has been removed in JSZip 3.0, please check the upgrade guide.');
    },
    ls = 0;
  ls < rv.length;
  ls++
)
  fu.prototype[rv[ls]] = p_;
var v_ = fu,
  Zm = {},
  Qn = {},
  Gn = {},
  tt = {};
(function (r) {
  var t = typeof Uint8Array < 'u' && typeof Uint16Array < 'u' && typeof Int32Array < 'u';
  function e(i, o) {
    return Object.prototype.hasOwnProperty.call(i, o);
  }
  (r.assign = function (i) {
    for (var o = Array.prototype.slice.call(arguments, 1); o.length; ) {
      var s = o.shift();
      if (s) {
        if (yr(s) != 'object') throw new TypeError(s + 'must be non-object');
        for (var u in s) e(s, u) && (i[u] = s[u]);
      }
    }
    return i;
  }),
    (r.shrinkBuf = function (i, o) {
      return i.length === o ? i : i.subarray ? i.subarray(0, o) : ((i.length = o), i);
    });
  var n = {
      arraySet: function (o, s, u, l, c) {
        if (s.subarray && o.subarray) o.set(s.subarray(u, u + l), c);
        else for (var h = 0; h < l; h++) o[c + h] = s[u + h];
      },
      flattenChunks: function (o) {
        var s, u, l, c, h, d;
        for (l = 0, s = 0, u = o.length; s < u; s++) l += o[s].length;
        for (d = new Uint8Array(l), c = 0, s = 0, u = o.length; s < u; s++) (h = o[s]), d.set(h, c), (c += h.length);
        return d;
      },
    },
    a = {
      arraySet: function (o, s, u, l, c) {
        for (var h = 0; h < l; h++) o[c + h] = s[u + h];
      },
      flattenChunks: function (o) {
        return [].concat.apply([], o);
      },
    };
  (r.setTyped = function (i) {
    i
      ? ((r.Buf8 = Uint8Array), (r.Buf16 = Uint16Array), (r.Buf32 = Int32Array), r.assign(r, n))
      : ((r.Buf8 = Array), (r.Buf16 = Array), (r.Buf32 = Array), r.assign(r, a));
  }),
    r.setTyped(t);
})(tt);
var tn = {},
  zr = {},
  Mt = {},
  m_ = tt;
function Zt(r) {
  for (var t = r.length; --t >= 0; ) r[t] = 0;
}
var Os = 256,
  Xm = 286,
  cn = 30,
  fn = 15,
  Ns = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0],
  Vn = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13],
  y_ = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7],
  tv = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15],
  Xr = new Array(576);
Zt(Xr);
var nn = new Array(60);
Zt(nn);
var mn = new Array(512);
Zt(mn);
var hn = new Array(256);
Zt(hn);
var hu = new Array(29);
Zt(hu);
var nv,
  av,
  iv,
  ea = new Array(cn);
function cs(r, t, e, n, a) {
  (this.static_tree = r),
    (this.extra_bits = t),
    (this.extra_base = e),
    (this.elems = n),
    (this.max_length = a),
    (this.has_stree = r && r.length);
}
function fs(r, t) {
  (this.dyn_tree = r), (this.max_code = 0), (this.stat_desc = t);
}
function Ym(r) {
  return r < 256 ? mn[r] : mn[256 + (r >>> 7)];
}
function yn(r, t) {
  (r.pending_buf[r.pending++] = 255 & t), (r.pending_buf[r.pending++] = (t >>> 8) & 255);
}
function mr(r, t, e) {
  r.bi_valid > 16 - e
    ? ((r.bi_buf |= (t << r.bi_valid) & 65535),
      yn(r, r.bi_buf),
      (r.bi_buf = t >> (16 - r.bi_valid)),
      (r.bi_valid += e - 16))
    : ((r.bi_buf |= (t << r.bi_valid) & 65535), (r.bi_valid += e));
}
function Hr(r, t, e) {
  mr(r, e[2 * t], e[2 * t + 1]);
}
function Jm(r, t) {
  var e = 0;
  do (e |= 1 & r), (r >>>= 1), (e <<= 1);
  while (--t > 0);
  return e >>> 1;
}
function Qm(r, t, e) {
  var n,
    a,
    i = new Array(16),
    o = 0;
  for (n = 1; n <= fn; n++) i[n] = o = (o + e[n - 1]) << 1;
  for (a = 0; a <= t; a++) {
    var s = r[2 * a + 1];
    s !== 0 && (r[2 * a] = Jm(i[s]++, s));
  }
}
function ov(r) {
  var t;
  for (t = 0; t < Xm; t++) r.dyn_ltree[2 * t] = 0;
  for (t = 0; t < cn; t++) r.dyn_dtree[2 * t] = 0;
  for (t = 0; t < 19; t++) r.bl_tree[2 * t] = 0;
  (r.dyn_ltree[512] = 1), (r.opt_len = r.static_len = 0), (r.last_lit = r.matches = 0);
}
function ey(r) {
  r.bi_valid > 8 ? yn(r, r.bi_buf) : r.bi_valid > 0 && (r.pending_buf[r.pending++] = r.bi_buf),
    (r.bi_buf = 0),
    (r.bi_valid = 0);
}
function sv(r, t, e, n) {
  var a = 2 * t,
    i = 2 * e;
  return r[a] < r[i] || (r[a] === r[i] && n[t] <= n[e]);
}
function hs(r, t, e) {
  for (
    var n = r.heap[e], a = e << 1;
    a <= r.heap_len &&
    (a < r.heap_len && sv(t, r.heap[a + 1], r.heap[a], r.depth) && a++, !sv(t, n, r.heap[a], r.depth));

  )
    (r.heap[e] = r.heap[a]), (e = a), (a <<= 1);
  r.heap[e] = n;
}
function uv(r, t, e) {
  var n,
    a,
    i,
    o,
    s = 0;
  if (r.last_lit !== 0)
    do
      (n = (r.pending_buf[r.d_buf + 2 * s] << 8) | r.pending_buf[r.d_buf + 2 * s + 1]),
        (a = r.pending_buf[r.l_buf + s]),
        s++,
        n === 0
          ? Hr(r, a, t)
          : (Hr(r, (i = hn[a]) + Os + 1, t),
            (o = Ns[i]) !== 0 && mr(r, (a -= hu[i]), o),
            Hr(r, (i = Ym(--n)), e),
            (o = Vn[i]) !== 0 && mr(r, (n -= ea[i]), o));
    while (s < r.last_lit);
  Hr(r, 256, t);
}
function ds(r, t) {
  var e,
    n,
    a,
    i = t.dyn_tree,
    o = t.stat_desc.static_tree,
    s = t.stat_desc.has_stree,
    u = t.stat_desc.elems,
    l = -1;
  for (r.heap_len = 0, r.heap_max = 573, e = 0; e < u; e++)
    i[2 * e] !== 0 ? ((r.heap[++r.heap_len] = l = e), (r.depth[e] = 0)) : (i[2 * e + 1] = 0);
  for (; r.heap_len < 2; )
    (i[2 * (a = r.heap[++r.heap_len] = l < 2 ? ++l : 0)] = 1),
      (r.depth[a] = 0),
      r.opt_len--,
      s && (r.static_len -= o[2 * a + 1]);
  for (t.max_code = l, e = r.heap_len >> 1; e >= 1; e--) hs(r, i, e);
  a = u;
  do
    (e = r.heap[1]),
      (r.heap[1] = r.heap[r.heap_len--]),
      hs(r, i, 1),
      (n = r.heap[1]),
      (r.heap[--r.heap_max] = e),
      (r.heap[--r.heap_max] = n),
      (i[2 * a] = i[2 * e] + i[2 * n]),
      (r.depth[a] = (r.depth[e] >= r.depth[n] ? r.depth[e] : r.depth[n]) + 1),
      (i[2 * e + 1] = i[2 * n + 1] = a),
      (r.heap[1] = a++),
      hs(r, i, 1);
  while (r.heap_len >= 2);
  (r.heap[--r.heap_max] = r.heap[1]),
    (function (c, h) {
      var d,
        f,
        p,
        v,
        y,
        E,
        _ = h.dyn_tree,
        g = h.max_code,
        b = h.stat_desc.static_tree,
        A = h.stat_desc.has_stree,
        w = h.stat_desc.extra_bits,
        T = h.stat_desc.extra_base,
        P = h.stat_desc.max_length,
        x = 0;
      for (v = 0; v <= fn; v++) c.bl_count[v] = 0;
      for (_[2 * c.heap[c.heap_max] + 1] = 0, d = c.heap_max + 1; d < 573; d++)
        (v = _[2 * _[2 * (f = c.heap[d]) + 1] + 1] + 1) > P && ((v = P), x++),
          (_[2 * f + 1] = v),
          f > g ||
            (c.bl_count[v]++,
            (y = 0),
            f >= T && (y = w[f - T]),
            (E = _[2 * f]),
            (c.opt_len += E * (v + y)),
            A && (c.static_len += E * (b[2 * f + 1] + y)));
      if (x !== 0) {
        do {
          for (v = P - 1; c.bl_count[v] === 0; ) v--;
          c.bl_count[v]--, (c.bl_count[v + 1] += 2), c.bl_count[P]--, (x -= 2);
        } while (x > 0);
        for (v = P; v !== 0; v--)
          for (f = c.bl_count[v]; f !== 0; )
            (p = c.heap[--d]) > g ||
              (_[2 * p + 1] !== v && ((c.opt_len += (v - _[2 * p + 1]) * _[2 * p]), (_[2 * p + 1] = v)), f--);
      }
    })(r, t),
    Qm(i, l, r.bl_count);
}
function lv(r, t, e) {
  var n,
    a,
    i = -1,
    o = t[1],
    s = 0,
    u = 7,
    l = 4;
  for (o === 0 && ((u = 138), (l = 3)), t[2 * (e + 1) + 1] = 65535, n = 0; n <= e; n++)
    (a = o),
      (o = t[2 * (n + 1) + 1]),
      (++s < u && a === o) ||
        (s < l
          ? (r.bl_tree[2 * a] += s)
          : a !== 0
          ? (a !== i && r.bl_tree[2 * a]++, r.bl_tree[32]++)
          : s <= 10
          ? r.bl_tree[34]++
          : r.bl_tree[36]++,
        (s = 0),
        (i = a),
        o === 0 ? ((u = 138), (l = 3)) : a === o ? ((u = 6), (l = 3)) : ((u = 7), (l = 4)));
}
function cv(r, t, e) {
  var n,
    a,
    i = -1,
    o = t[1],
    s = 0,
    u = 7,
    l = 4;
  for (o === 0 && ((u = 138), (l = 3)), n = 0; n <= e; n++)
    if (((a = o), (o = t[2 * (n + 1) + 1]), !(++s < u && a === o))) {
      if (s < l)
        do Hr(r, a, r.bl_tree);
        while (--s != 0);
      else
        a !== 0
          ? (a !== i && (Hr(r, a, r.bl_tree), s--), Hr(r, 16, r.bl_tree), mr(r, s - 3, 2))
          : s <= 10
          ? (Hr(r, 17, r.bl_tree), mr(r, s - 3, 3))
          : (Hr(r, 18, r.bl_tree), mr(r, s - 11, 7));
      (s = 0), (i = a), o === 0 ? ((u = 138), (l = 3)) : a === o ? ((u = 6), (l = 3)) : ((u = 7), (l = 4));
    }
}
Zt(ea);
var fv = !1;
function hv(r, t, e, n) {
  mr(r, 0 + (n ? 1 : 0), 3),
    (function (a, i, o, s) {
      ey(a), yn(a, o), yn(a, ~o), m_.arraySet(a.pending_buf, a.window, i, o, a.pending), (a.pending += o);
    })(r, t, e);
}
(Mt._tr_init = function (r) {
  fv ||
    ((function () {
      var t,
        e,
        n,
        a,
        i,
        o = new Array(16);
      for (n = 0, a = 0; a < 28; a++) for (hu[a] = n, t = 0; t < 1 << Ns[a]; t++) hn[n++] = a;
      for (hn[n - 1] = a, i = 0, a = 0; a < 16; a++) for (ea[a] = i, t = 0; t < 1 << Vn[a]; t++) mn[i++] = a;
      for (i >>= 7; a < cn; a++) for (ea[a] = i << 7, t = 0; t < 1 << (Vn[a] - 7); t++) mn[256 + i++] = a;
      for (e = 0; e <= fn; e++) o[e] = 0;
      for (t = 0; t <= 143; ) (Xr[2 * t + 1] = 8), t++, o[8]++;
      for (; t <= 255; ) (Xr[2 * t + 1] = 9), t++, o[9]++;
      for (; t <= 279; ) (Xr[2 * t + 1] = 7), t++, o[7]++;
      for (; t <= 287; ) (Xr[2 * t + 1] = 8), t++, o[8]++;
      for (Qm(Xr, 287, o), t = 0; t < cn; t++) (nn[2 * t + 1] = 5), (nn[2 * t] = Jm(t, 5));
      (nv = new cs(Xr, Ns, 257, Xm, fn)), (av = new cs(nn, Vn, 0, cn, fn)), (iv = new cs(new Array(0), y_, 0, 19, 7));
    })(),
    (fv = !0)),
    (r.l_desc = new fs(r.dyn_ltree, nv)),
    (r.d_desc = new fs(r.dyn_dtree, av)),
    (r.bl_desc = new fs(r.bl_tree, iv)),
    (r.bi_buf = 0),
    (r.bi_valid = 0),
    ov(r);
}),
  (Mt._tr_stored_block = hv),
  (Mt._tr_flush_block = function (r, t, e, n) {
    var a,
      i,
      o = 0;
    r.level > 0
      ? (r.strm.data_type === 2 &&
          (r.strm.data_type = (function (s) {
            var u,
              l = 4093624447;
            for (u = 0; u <= 31; u++, l >>>= 1) if (1 & l && s.dyn_ltree[2 * u] !== 0) return 0;
            if (s.dyn_ltree[18] !== 0 || s.dyn_ltree[20] !== 0 || s.dyn_ltree[26] !== 0) return 1;
            for (u = 32; u < Os; u++) if (s.dyn_ltree[2 * u] !== 0) return 1;
            return 0;
          })(r)),
        ds(r, r.l_desc),
        ds(r, r.d_desc),
        (o = (function (s) {
          var u;
          for (
            lv(s, s.dyn_ltree, s.l_desc.max_code), lv(s, s.dyn_dtree, s.d_desc.max_code), ds(s, s.bl_desc), u = 18;
            u >= 3 && s.bl_tree[2 * tv[u] + 1] === 0;
            u--
          );
          return (s.opt_len += 3 * (u + 1) + 5 + 5 + 4), u;
        })(r)),
        (a = (r.opt_len + 3 + 7) >>> 3),
        (i = (r.static_len + 3 + 7) >>> 3) <= a && (a = i))
      : (a = i = e + 5),
      e + 4 <= a && t !== -1
        ? hv(r, t, e, n)
        : r.strategy === 4 || i === a
        ? (mr(r, 2 + (n ? 1 : 0), 3), uv(r, Xr, nn))
        : (mr(r, 4 + (n ? 1 : 0), 3),
          (function (s, u, l, c) {
            var h;
            for (mr(s, u - 257, 5), mr(s, l - 1, 5), mr(s, c - 4, 4), h = 0; h < c; h++)
              mr(s, s.bl_tree[2 * tv[h] + 1], 3);
            cv(s, s.dyn_ltree, u - 1), cv(s, s.dyn_dtree, l - 1);
          })(r, r.l_desc.max_code + 1, r.d_desc.max_code + 1, o + 1),
          uv(r, r.dyn_ltree, r.dyn_dtree)),
      ov(r),
      n && ey(r);
  }),
  (Mt._tr_tally = function (r, t, e) {
    return (
      (r.pending_buf[r.d_buf + 2 * r.last_lit] = (t >>> 8) & 255),
      (r.pending_buf[r.d_buf + 2 * r.last_lit + 1] = 255 & t),
      (r.pending_buf[r.l_buf + r.last_lit] = 255 & e),
      r.last_lit++,
      t === 0
        ? r.dyn_ltree[2 * e]++
        : (r.matches++, t--, r.dyn_ltree[2 * (hn[e] + Os + 1)]++, r.dyn_dtree[2 * Ym(t)]++),
      r.last_lit === r.lit_bufsize - 1
    );
  }),
  (Mt._tr_align = function (r) {
    mr(r, 2, 3),
      Hr(r, 256, Xr),
      (function (t) {
        t.bi_valid === 16
          ? (yn(t, t.bi_buf), (t.bi_buf = 0), (t.bi_valid = 0))
          : t.bi_valid >= 8 && ((t.pending_buf[t.pending++] = 255 & t.bi_buf), (t.bi_buf >>= 8), (t.bi_valid -= 8));
      })(r);
  });
var ry = function (t, e, n, a) {
    for (var i = 65535 & t, o = (t >>> 16) & 65535, s = 0; n !== 0; ) {
      n -= s = n > 2e3 ? 2e3 : n;
      do o = (o + (i = (i + e[a++]) | 0)) | 0;
      while (--s);
      (i %= 65521), (o %= 65521);
    }
    return i | (o << 16);
  },
  g_ = (function () {
    for (var r, t = [], e = 0; e < 256; e++) {
      r = e;
      for (var n = 0; n < 8; n++) r = 1 & r ? 3988292384 ^ (r >>> 1) : r >>> 1;
      t[e] = r;
    }
    return t;
  })(),
  Dt,
  ty = function (t, e, n, a) {
    var i = g_,
      o = a + n;
    t ^= -1;
    for (var s = a; s < o; s++) t = (t >>> 8) ^ i[255 & (t ^ e[s])];
    return ~t;
  },
  du = {
    2: 'need dictionary',
    1: 'stream end',
    0: '',
    '-1': 'file error',
    '-2': 'stream error',
    '-3': 'data error',
    '-4': 'insufficient memory',
    '-5': 'buffer error',
    '-6': 'incompatible version',
  },
  hr = tt,
  Cr = Mt,
  ny = ry,
  it = ty,
  b_ = du,
  Pr = -2,
  St = 258,
  Dr = 262,
  Bn = 103,
  yt = 113,
  Xt = 666;
function st(r, t) {
  return (r.msg = b_[t]), t;
}
function dv(r) {
  return (r << 1) - (r > 4 ? 9 : 0);
}
function lt(r) {
  for (var t = r.length; --t >= 0; ) r[t] = 0;
}
function ot(r) {
  var t = r.state,
    e = t.pending;
  e > r.avail_out && (e = r.avail_out),
    e !== 0 &&
      (hr.arraySet(r.output, t.pending_buf, t.pending_out, e, r.next_out),
      (r.next_out += e),
      (t.pending_out += e),
      (r.total_out += e),
      (r.avail_out -= e),
      (t.pending -= e),
      t.pending === 0 && (t.pending_out = 0));
}
function or(r, t) {
  Cr._tr_flush_block(r, r.block_start >= 0 ? r.block_start : -1, r.strstart - r.block_start, t),
    (r.block_start = r.strstart),
    ot(r.strm);
}
function Ae(r, t) {
  r.pending_buf[r.pending++] = t;
}
function Yt(r, t) {
  (r.pending_buf[r.pending++] = (t >>> 8) & 255), (r.pending_buf[r.pending++] = 255 & t);
}
function ay(r, t) {
  var e,
    n,
    a = r.max_chain_length,
    i = r.strstart,
    o = r.prev_length,
    s = r.nice_match,
    u = r.strstart > r.w_size - Dr ? r.strstart - (r.w_size - Dr) : 0,
    l = r.window,
    c = r.w_mask,
    h = r.prev,
    d = r.strstart + St,
    f = l[i + o - 1],
    p = l[i + o];
  r.prev_length >= r.good_match && (a >>= 2), s > r.lookahead && (s = r.lookahead);
  do
    if (l[(e = t) + o] === p && l[e + o - 1] === f && l[e] === l[i] && l[++e] === l[i + 1]) {
      (i += 2), e++;
      do;
      while (
        l[++i] === l[++e] &&
        l[++i] === l[++e] &&
        l[++i] === l[++e] &&
        l[++i] === l[++e] &&
        l[++i] === l[++e] &&
        l[++i] === l[++e] &&
        l[++i] === l[++e] &&
        l[++i] === l[++e] &&
        i < d
      );
      if (((n = St - (d - i)), (i = d - St), n > o)) {
        if (((r.match_start = t), (o = n), n >= s)) break;
        (f = l[i + o - 1]), (p = l[i + o]);
      }
    }
  while ((t = h[t & c]) > u && --a != 0);
  return o <= r.lookahead ? o : r.lookahead;
}
function bt(r) {
  var t,
    e,
    n,
    a,
    i,
    o,
    s,
    u,
    l,
    c,
    h = r.w_size;
  do {
    if (((a = r.window_size - r.lookahead - r.strstart), r.strstart >= h + (h - Dr))) {
      hr.arraySet(r.window, r.window, h, h, 0),
        (r.match_start -= h),
        (r.strstart -= h),
        (r.block_start -= h),
        (t = e = r.hash_size);
      do (n = r.head[--t]), (r.head[t] = n >= h ? n - h : 0);
      while (--e);
      t = e = h;
      do (n = r.prev[--t]), (r.prev[t] = n >= h ? n - h : 0);
      while (--e);
      a += h;
    }
    if (r.strm.avail_in === 0) break;
    if (
      ((o = r.strm),
      (s = r.window),
      (u = r.strstart + r.lookahead),
      (l = a),
      (c = void 0),
      (c = o.avail_in) > l && (c = l),
      (e =
        c === 0
          ? 0
          : ((o.avail_in -= c),
            hr.arraySet(s, o.input, o.next_in, c, u),
            o.state.wrap === 1
              ? (o.adler = ny(o.adler, s, c, u))
              : o.state.wrap === 2 && (o.adler = it(o.adler, s, c, u)),
            (o.next_in += c),
            (o.total_in += c),
            c)),
      (r.lookahead += e),
      r.lookahead + r.insert >= 3)
    )
      for (
        i = r.strstart - r.insert,
          r.ins_h = r.window[i],
          r.ins_h = ((r.ins_h << r.hash_shift) ^ r.window[i + 1]) & r.hash_mask;
        r.insert &&
        ((r.ins_h = ((r.ins_h << r.hash_shift) ^ r.window[i + 3 - 1]) & r.hash_mask),
        (r.prev[i & r.w_mask] = r.head[r.ins_h]),
        (r.head[r.ins_h] = i),
        i++,
        r.insert--,
        !(r.lookahead + r.insert < 3));

      );
  } while (r.lookahead < Dr && r.strm.avail_in !== 0);
}
function ps(r, t) {
  for (var e, n; ; ) {
    if (r.lookahead < Dr) {
      if ((bt(r), r.lookahead < Dr && t === 0)) return 1;
      if (r.lookahead === 0) break;
    }
    if (
      ((e = 0),
      r.lookahead >= 3 &&
        ((r.ins_h = ((r.ins_h << r.hash_shift) ^ r.window[r.strstart + 3 - 1]) & r.hash_mask),
        (e = r.prev[r.strstart & r.w_mask] = r.head[r.ins_h]),
        (r.head[r.ins_h] = r.strstart)),
      e !== 0 && r.strstart - e <= r.w_size - Dr && (r.match_length = ay(r, e)),
      r.match_length >= 3)
    )
      if (
        ((n = Cr._tr_tally(r, r.strstart - r.match_start, r.match_length - 3)),
        (r.lookahead -= r.match_length),
        r.match_length <= r.max_lazy_match && r.lookahead >= 3)
      ) {
        r.match_length--;
        do
          r.strstart++,
            (r.ins_h = ((r.ins_h << r.hash_shift) ^ r.window[r.strstart + 3 - 1]) & r.hash_mask),
            (e = r.prev[r.strstart & r.w_mask] = r.head[r.ins_h]),
            (r.head[r.ins_h] = r.strstart);
        while (--r.match_length != 0);
        r.strstart++;
      } else
        (r.strstart += r.match_length),
          (r.match_length = 0),
          (r.ins_h = r.window[r.strstart]),
          (r.ins_h = ((r.ins_h << r.hash_shift) ^ r.window[r.strstart + 1]) & r.hash_mask);
    else (n = Cr._tr_tally(r, 0, r.window[r.strstart])), r.lookahead--, r.strstart++;
    if (n && (or(r, !1), r.strm.avail_out === 0)) return 1;
  }
  return (
    (r.insert = r.strstart < 2 ? r.strstart : 2),
    t === 4 ? (or(r, !0), r.strm.avail_out === 0 ? 3 : 4) : r.last_lit && (or(r, !1), r.strm.avail_out === 0) ? 1 : 2
  );
}
function Ct(r, t) {
  for (var e, n, a; ; ) {
    if (r.lookahead < Dr) {
      if ((bt(r), r.lookahead < Dr && t === 0)) return 1;
      if (r.lookahead === 0) break;
    }
    if (
      ((e = 0),
      r.lookahead >= 3 &&
        ((r.ins_h = ((r.ins_h << r.hash_shift) ^ r.window[r.strstart + 3 - 1]) & r.hash_mask),
        (e = r.prev[r.strstart & r.w_mask] = r.head[r.ins_h]),
        (r.head[r.ins_h] = r.strstart)),
      (r.prev_length = r.match_length),
      (r.prev_match = r.match_start),
      (r.match_length = 2),
      e !== 0 &&
        r.prev_length < r.max_lazy_match &&
        r.strstart - e <= r.w_size - Dr &&
        ((r.match_length = ay(r, e)),
        r.match_length <= 5 &&
          (r.strategy === 1 || (r.match_length === 3 && r.strstart - r.match_start > 4096)) &&
          (r.match_length = 2)),
      r.prev_length >= 3 && r.match_length <= r.prev_length)
    ) {
      (a = r.strstart + r.lookahead - 3),
        (n = Cr._tr_tally(r, r.strstart - 1 - r.prev_match, r.prev_length - 3)),
        (r.lookahead -= r.prev_length - 1),
        (r.prev_length -= 2);
      do
        ++r.strstart <= a &&
          ((r.ins_h = ((r.ins_h << r.hash_shift) ^ r.window[r.strstart + 3 - 1]) & r.hash_mask),
          (e = r.prev[r.strstart & r.w_mask] = r.head[r.ins_h]),
          (r.head[r.ins_h] = r.strstart));
      while (--r.prev_length != 0);
      if (((r.match_available = 0), (r.match_length = 2), r.strstart++, n && (or(r, !1), r.strm.avail_out === 0)))
        return 1;
    } else if (r.match_available) {
      if (
        ((n = Cr._tr_tally(r, 0, r.window[r.strstart - 1])) && or(r, !1),
        r.strstart++,
        r.lookahead--,
        r.strm.avail_out === 0)
      )
        return 1;
    } else (r.match_available = 1), r.strstart++, r.lookahead--;
  }
  return (
    r.match_available && ((n = Cr._tr_tally(r, 0, r.window[r.strstart - 1])), (r.match_available = 0)),
    (r.insert = r.strstart < 2 ? r.strstart : 2),
    t === 4 ? (or(r, !0), r.strm.avail_out === 0 ? 3 : 4) : r.last_lit && (or(r, !1), r.strm.avail_out === 0) ? 1 : 2
  );
}
function Lr(r, t, e, n, a) {
  (this.good_length = r), (this.max_lazy = t), (this.nice_length = e), (this.max_chain = n), (this.func = a);
}
function __() {
  (this.strm = null),
    (this.status = 0),
    (this.pending_buf = null),
    (this.pending_buf_size = 0),
    (this.pending_out = 0),
    (this.pending = 0),
    (this.wrap = 0),
    (this.gzhead = null),
    (this.gzindex = 0),
    (this.method = 8),
    (this.last_flush = -1),
    (this.w_size = 0),
    (this.w_bits = 0),
    (this.w_mask = 0),
    (this.window = null),
    (this.window_size = 0),
    (this.prev = null),
    (this.head = null),
    (this.ins_h = 0),
    (this.hash_size = 0),
    (this.hash_bits = 0),
    (this.hash_mask = 0),
    (this.hash_shift = 0),
    (this.block_start = 0),
    (this.match_length = 0),
    (this.prev_match = 0),
    (this.match_available = 0),
    (this.strstart = 0),
    (this.match_start = 0),
    (this.lookahead = 0),
    (this.prev_length = 0),
    (this.max_chain_length = 0),
    (this.max_lazy_match = 0),
    (this.level = 0),
    (this.strategy = 0),
    (this.good_match = 0),
    (this.nice_match = 0),
    (this.dyn_ltree = new hr.Buf16(1146)),
    (this.dyn_dtree = new hr.Buf16(122)),
    (this.bl_tree = new hr.Buf16(78)),
    lt(this.dyn_ltree),
    lt(this.dyn_dtree),
    lt(this.bl_tree),
    (this.l_desc = null),
    (this.d_desc = null),
    (this.bl_desc = null),
    (this.bl_count = new hr.Buf16(16)),
    (this.heap = new hr.Buf16(573)),
    lt(this.heap),
    (this.heap_len = 0),
    (this.heap_max = 0),
    (this.depth = new hr.Buf16(573)),
    lt(this.depth),
    (this.l_buf = 0),
    (this.lit_bufsize = 0),
    (this.last_lit = 0),
    (this.d_buf = 0),
    (this.opt_len = 0),
    (this.static_len = 0),
    (this.matches = 0),
    (this.insert = 0),
    (this.bi_buf = 0),
    (this.bi_valid = 0);
}
function iy(r) {
  var t;
  return r && r.state
    ? ((r.total_in = r.total_out = 0),
      (r.data_type = 2),
      ((t = r.state).pending = 0),
      (t.pending_out = 0),
      t.wrap < 0 && (t.wrap = -t.wrap),
      (t.status = t.wrap ? 42 : yt),
      (r.adler = t.wrap === 2 ? 0 : 1),
      (t.last_flush = 0),
      Cr._tr_init(t),
      0)
    : st(r, Pr);
}
function oy(r) {
  var t,
    e = iy(r);
  return (
    e === 0 &&
      (((t = r.state).window_size = 2 * t.w_size),
      lt(t.head),
      (t.max_lazy_match = Dt[t.level].max_lazy),
      (t.good_match = Dt[t.level].good_length),
      (t.nice_match = Dt[t.level].nice_length),
      (t.max_chain_length = Dt[t.level].max_chain),
      (t.strstart = 0),
      (t.block_start = 0),
      (t.lookahead = 0),
      (t.insert = 0),
      (t.match_length = t.prev_length = 2),
      (t.match_available = 0),
      (t.ins_h = 0)),
    e
  );
}
function pv(r, t, e, n, a, i) {
  if (!r) return Pr;
  var o = 1;
  if (
    (t === -1 && (t = 6),
    n < 0 ? ((o = 0), (n = -n)) : n > 15 && ((o = 2), (n -= 16)),
    a < 1 || a > 9 || e !== 8 || n < 8 || n > 15 || t < 0 || t > 9 || i < 0 || i > 4)
  )
    return st(r, Pr);
  n === 8 && (n = 9);
  var s = new __();
  return (
    (r.state = s),
    (s.strm = r),
    (s.wrap = o),
    (s.gzhead = null),
    (s.w_bits = n),
    (s.w_size = 1 << s.w_bits),
    (s.w_mask = s.w_size - 1),
    (s.hash_bits = a + 7),
    (s.hash_size = 1 << s.hash_bits),
    (s.hash_mask = s.hash_size - 1),
    (s.hash_shift = ~~((s.hash_bits + 3 - 1) / 3)),
    (s.window = new hr.Buf8(2 * s.w_size)),
    (s.head = new hr.Buf16(s.hash_size)),
    (s.prev = new hr.Buf16(s.w_size)),
    (s.lit_bufsize = 1 << (a + 6)),
    (s.pending_buf_size = 4 * s.lit_bufsize),
    (s.pending_buf = new hr.Buf8(s.pending_buf_size)),
    (s.d_buf = 1 * s.lit_bufsize),
    (s.l_buf = 3 * s.lit_bufsize),
    (s.level = t),
    (s.strategy = i),
    (s.method = e),
    oy(r)
  );
}
(Dt = [
  new Lr(0, 0, 0, 0, function (r, t) {
    var e = 65535;
    for (e > r.pending_buf_size - 5 && (e = r.pending_buf_size - 5); ; ) {
      if (r.lookahead <= 1) {
        if ((bt(r), r.lookahead === 0 && t === 0)) return 1;
        if (r.lookahead === 0) break;
      }
      (r.strstart += r.lookahead), (r.lookahead = 0);
      var n = r.block_start + e;
      if (
        ((r.strstart === 0 || r.strstart >= n) &&
          ((r.lookahead = r.strstart - n), (r.strstart = n), or(r, !1), r.strm.avail_out === 0)) ||
        (r.strstart - r.block_start >= r.w_size - Dr && (or(r, !1), r.strm.avail_out === 0))
      )
        return 1;
    }
    return (
      (r.insert = 0),
      t === 4
        ? (or(r, !0), r.strm.avail_out === 0 ? 3 : 4)
        : (r.strstart > r.block_start && (or(r, !1), r.strm.avail_out), 1)
    );
  }),
  new Lr(4, 4, 8, 4, ps),
  new Lr(4, 5, 16, 8, ps),
  new Lr(4, 6, 32, 32, ps),
  new Lr(4, 4, 16, 16, Ct),
  new Lr(8, 16, 32, 32, Ct),
  new Lr(8, 16, 128, 128, Ct),
  new Lr(8, 32, 128, 256, Ct),
  new Lr(32, 128, 258, 1024, Ct),
  new Lr(32, 258, 258, 4096, Ct),
]),
  (zr.deflateInit = function (r, t) {
    return pv(r, t, 8, 15, 8, 0);
  }),
  (zr.deflateInit2 = pv),
  (zr.deflateReset = oy),
  (zr.deflateResetKeep = iy),
  (zr.deflateSetHeader = function (r, t) {
    return r && r.state ? (r.state.wrap !== 2 ? Pr : ((r.state.gzhead = t), 0)) : Pr;
  }),
  (zr.deflate = function (r, t) {
    var e, n, a, i;
    if (!r || !r.state || t > 5 || t < 0) return r ? st(r, Pr) : Pr;
    if (((n = r.state), !r.output || (!r.input && r.avail_in !== 0) || (n.status === Xt && t !== 4)))
      return st(r, r.avail_out === 0 ? -5 : Pr);
    if (((n.strm = r), (e = n.last_flush), (n.last_flush = t), n.status === 42))
      if (n.wrap === 2)
        (r.adler = 0),
          Ae(n, 31),
          Ae(n, 139),
          Ae(n, 8),
          n.gzhead
            ? (Ae(
                n,
                (n.gzhead.text ? 1 : 0) +
                  (n.gzhead.hcrc ? 2 : 0) +
                  (n.gzhead.extra ? 4 : 0) +
                  (n.gzhead.name ? 8 : 0) +
                  (n.gzhead.comment ? 16 : 0)
              ),
              Ae(n, 255 & n.gzhead.time),
              Ae(n, (n.gzhead.time >> 8) & 255),
              Ae(n, (n.gzhead.time >> 16) & 255),
              Ae(n, (n.gzhead.time >> 24) & 255),
              Ae(n, n.level === 9 ? 2 : n.strategy >= 2 || n.level < 2 ? 4 : 0),
              Ae(n, 255 & n.gzhead.os),
              n.gzhead.extra &&
                n.gzhead.extra.length &&
                (Ae(n, 255 & n.gzhead.extra.length), Ae(n, (n.gzhead.extra.length >> 8) & 255)),
              n.gzhead.hcrc && (r.adler = it(r.adler, n.pending_buf, n.pending, 0)),
              (n.gzindex = 0),
              (n.status = 69))
            : (Ae(n, 0),
              Ae(n, 0),
              Ae(n, 0),
              Ae(n, 0),
              Ae(n, 0),
              Ae(n, n.level === 9 ? 2 : n.strategy >= 2 || n.level < 2 ? 4 : 0),
              Ae(n, 3),
              (n.status = yt));
      else {
        var o = (8 + ((n.w_bits - 8) << 4)) << 8;
        (o |= (n.strategy >= 2 || n.level < 2 ? 0 : n.level < 6 ? 1 : n.level === 6 ? 2 : 3) << 6),
          n.strstart !== 0 && (o |= 32),
          (o += 31 - (o % 31)),
          (n.status = yt),
          Yt(n, o),
          n.strstart !== 0 && (Yt(n, r.adler >>> 16), Yt(n, 65535 & r.adler)),
          (r.adler = 1);
      }
    if (n.status === 69)
      if (n.gzhead.extra) {
        for (
          a = n.pending;
          n.gzindex < (65535 & n.gzhead.extra.length) &&
          (n.pending !== n.pending_buf_size ||
            (n.gzhead.hcrc && n.pending > a && (r.adler = it(r.adler, n.pending_buf, n.pending - a, a)),
            ot(r),
            (a = n.pending),
            n.pending !== n.pending_buf_size));

        )
          Ae(n, 255 & n.gzhead.extra[n.gzindex]), n.gzindex++;
        n.gzhead.hcrc && n.pending > a && (r.adler = it(r.adler, n.pending_buf, n.pending - a, a)),
          n.gzindex === n.gzhead.extra.length && ((n.gzindex = 0), (n.status = 73));
      } else n.status = 73;
    if (n.status === 73)
      if (n.gzhead.name) {
        a = n.pending;
        do {
          if (
            n.pending === n.pending_buf_size &&
            (n.gzhead.hcrc && n.pending > a && (r.adler = it(r.adler, n.pending_buf, n.pending - a, a)),
            ot(r),
            (a = n.pending),
            n.pending === n.pending_buf_size)
          ) {
            i = 1;
            break;
          }
          (i = n.gzindex < n.gzhead.name.length ? 255 & n.gzhead.name.charCodeAt(n.gzindex++) : 0), Ae(n, i);
        } while (i !== 0);
        n.gzhead.hcrc && n.pending > a && (r.adler = it(r.adler, n.pending_buf, n.pending - a, a)),
          i === 0 && ((n.gzindex = 0), (n.status = 91));
      } else n.status = 91;
    if (n.status === 91)
      if (n.gzhead.comment) {
        a = n.pending;
        do {
          if (
            n.pending === n.pending_buf_size &&
            (n.gzhead.hcrc && n.pending > a && (r.adler = it(r.adler, n.pending_buf, n.pending - a, a)),
            ot(r),
            (a = n.pending),
            n.pending === n.pending_buf_size)
          ) {
            i = 1;
            break;
          }
          (i = n.gzindex < n.gzhead.comment.length ? 255 & n.gzhead.comment.charCodeAt(n.gzindex++) : 0), Ae(n, i);
        } while (i !== 0);
        n.gzhead.hcrc && n.pending > a && (r.adler = it(r.adler, n.pending_buf, n.pending - a, a)),
          i === 0 && (n.status = Bn);
      } else n.status = Bn;
    if (
      (n.status === Bn &&
        (n.gzhead.hcrc
          ? (n.pending + 2 > n.pending_buf_size && ot(r),
            n.pending + 2 <= n.pending_buf_size &&
              (Ae(n, 255 & r.adler), Ae(n, (r.adler >> 8) & 255), (r.adler = 0), (n.status = yt)))
          : (n.status = yt)),
      n.pending !== 0)
    ) {
      if ((ot(r), r.avail_out === 0)) return (n.last_flush = -1), 0;
    } else if (r.avail_in === 0 && dv(t) <= dv(e) && t !== 4) return st(r, -5);
    if (n.status === Xt && r.avail_in !== 0) return st(r, -5);
    if (r.avail_in !== 0 || n.lookahead !== 0 || (t !== 0 && n.status !== Xt)) {
      var s =
        n.strategy === 2
          ? (function (u, l) {
              for (var c; ; ) {
                if (u.lookahead === 0 && (bt(u), u.lookahead === 0)) {
                  if (l === 0) return 1;
                  break;
                }
                if (
                  ((u.match_length = 0),
                  (c = Cr._tr_tally(u, 0, u.window[u.strstart])),
                  u.lookahead--,
                  u.strstart++,
                  c && (or(u, !1), u.strm.avail_out === 0))
                )
                  return 1;
              }
              return (
                (u.insert = 0),
                l === 4
                  ? (or(u, !0), u.strm.avail_out === 0 ? 3 : 4)
                  : u.last_lit && (or(u, !1), u.strm.avail_out === 0)
                  ? 1
                  : 2
              );
            })(n, t)
          : n.strategy === 3
          ? (function (u, l) {
              for (var c, h, d, f, p = u.window; ; ) {
                if (u.lookahead <= St) {
                  if ((bt(u), u.lookahead <= St && l === 0)) return 1;
                  if (u.lookahead === 0) break;
                }
                if (
                  ((u.match_length = 0),
                  u.lookahead >= 3 &&
                    u.strstart > 0 &&
                    (h = p[(d = u.strstart - 1)]) === p[++d] &&
                    h === p[++d] &&
                    h === p[++d])
                ) {
                  f = u.strstart + St;
                  do;
                  while (
                    h === p[++d] &&
                    h === p[++d] &&
                    h === p[++d] &&
                    h === p[++d] &&
                    h === p[++d] &&
                    h === p[++d] &&
                    h === p[++d] &&
                    h === p[++d] &&
                    d < f
                  );
                  (u.match_length = St - (f - d)), u.match_length > u.lookahead && (u.match_length = u.lookahead);
                }
                if (
                  (u.match_length >= 3
                    ? ((c = Cr._tr_tally(u, 1, u.match_length - 3)),
                      (u.lookahead -= u.match_length),
                      (u.strstart += u.match_length),
                      (u.match_length = 0))
                    : ((c = Cr._tr_tally(u, 0, u.window[u.strstart])), u.lookahead--, u.strstart++),
                  c && (or(u, !1), u.strm.avail_out === 0))
                )
                  return 1;
              }
              return (
                (u.insert = 0),
                l === 4
                  ? (or(u, !0), u.strm.avail_out === 0 ? 3 : 4)
                  : u.last_lit && (or(u, !1), u.strm.avail_out === 0)
                  ? 1
                  : 2
              );
            })(n, t)
          : Dt[n.level].func(n, t);
      if (((s !== 3 && s !== 4) || (n.status = Xt), s === 1 || s === 3))
        return r.avail_out === 0 && (n.last_flush = -1), 0;
      if (
        s === 2 &&
        (t === 1
          ? Cr._tr_align(n)
          : t !== 5 &&
            (Cr._tr_stored_block(n, 0, 0, !1),
            t === 3 && (lt(n.head), n.lookahead === 0 && ((n.strstart = 0), (n.block_start = 0), (n.insert = 0)))),
        ot(r),
        r.avail_out === 0)
      )
        return (n.last_flush = -1), 0;
    }
    return t !== 4
      ? 0
      : n.wrap <= 0
      ? 1
      : (n.wrap === 2
          ? (Ae(n, 255 & r.adler),
            Ae(n, (r.adler >> 8) & 255),
            Ae(n, (r.adler >> 16) & 255),
            Ae(n, (r.adler >> 24) & 255),
            Ae(n, 255 & r.total_in),
            Ae(n, (r.total_in >> 8) & 255),
            Ae(n, (r.total_in >> 16) & 255),
            Ae(n, (r.total_in >> 24) & 255))
          : (Yt(n, r.adler >>> 16), Yt(n, 65535 & r.adler)),
        ot(r),
        n.wrap > 0 && (n.wrap = -n.wrap),
        n.pending !== 0 ? 0 : 1);
  }),
  (zr.deflateEnd = function (r) {
    var t;
    return r && r.state
      ? (t = r.state.status) !== 42 && t !== 69 && t !== 73 && t !== 91 && t !== Bn && t !== yt && t !== Xt
        ? st(r, Pr)
        : ((r.state = null), t === yt ? st(r, -3) : 0)
      : Pr;
  }),
  (zr.deflateSetDictionary = function (r, t) {
    var e,
      n,
      a,
      i,
      o,
      s,
      u,
      l,
      c = t.length;
    if (!r || !r.state || (i = (e = r.state).wrap) === 2 || (i === 1 && e.status !== 42) || e.lookahead) return Pr;
    for (
      i === 1 && (r.adler = ny(r.adler, t, c, 0)),
        e.wrap = 0,
        c >= e.w_size &&
          (i === 0 && (lt(e.head), (e.strstart = 0), (e.block_start = 0), (e.insert = 0)),
          (l = new hr.Buf8(e.w_size)),
          hr.arraySet(l, t, c - e.w_size, e.w_size, 0),
          (t = l),
          (c = e.w_size)),
        o = r.avail_in,
        s = r.next_in,
        u = r.input,
        r.avail_in = c,
        r.next_in = 0,
        r.input = t,
        bt(e);
      e.lookahead >= 3;

    ) {
      (n = e.strstart), (a = e.lookahead - 2);
      do
        (e.ins_h = ((e.ins_h << e.hash_shift) ^ e.window[n + 3 - 1]) & e.hash_mask),
          (e.prev[n & e.w_mask] = e.head[e.ins_h]),
          (e.head[e.ins_h] = n),
          n++;
      while (--a);
      (e.strstart = n), (e.lookahead = 2), bt(e);
    }
    return (
      (e.strstart += e.lookahead),
      (e.block_start = e.strstart),
      (e.insert = e.lookahead),
      (e.lookahead = 0),
      (e.match_length = e.prev_length = 2),
      (e.match_available = 0),
      (r.next_in = s),
      (r.input = u),
      (r.avail_in = o),
      (e.wrap = i),
      0
    );
  }),
  (zr.deflateInfo = 'pako deflate (from Nodeca project)');
var _t = {},
  ra = tt,
  sy = !0,
  uy = !0;
try {
  String.fromCharCode.apply(null, [0]);
} catch {
  sy = !1;
}
try {
  String.fromCharCode.apply(null, new Uint8Array(1));
} catch {
  uy = !1;
}
for (var an = new ra.Buf8(256), nt = 0; nt < 256; nt++)
  an[nt] = nt >= 252 ? 6 : nt >= 248 ? 5 : nt >= 240 ? 4 : nt >= 224 ? 3 : nt >= 192 ? 2 : 1;
function vv(r, t) {
  if (t < 65534 && ((r.subarray && uy) || (!r.subarray && sy)))
    return String.fromCharCode.apply(null, ra.shrinkBuf(r, t));
  for (var e = '', n = 0; n < t; n++) e += String.fromCharCode(r[n]);
  return e;
}
(an[254] = an[254] = 1),
  (_t.string2buf = function (r) {
    var t,
      e,
      n,
      a,
      i,
      o = r.length,
      s = 0;
    for (a = 0; a < o; a++)
      (64512 & (e = r.charCodeAt(a))) == 55296 &&
        a + 1 < o &&
        (64512 & (n = r.charCodeAt(a + 1))) == 56320 &&
        ((e = 65536 + ((e - 55296) << 10) + (n - 56320)), a++),
        (s += e < 128 ? 1 : e < 2048 ? 2 : e < 65536 ? 3 : 4);
    for (t = new ra.Buf8(s), i = 0, a = 0; i < s; a++)
      (64512 & (e = r.charCodeAt(a))) == 55296 &&
        a + 1 < o &&
        (64512 & (n = r.charCodeAt(a + 1))) == 56320 &&
        ((e = 65536 + ((e - 55296) << 10) + (n - 56320)), a++),
        e < 128
          ? (t[i++] = e)
          : e < 2048
          ? ((t[i++] = 192 | (e >>> 6)), (t[i++] = 128 | (63 & e)))
          : e < 65536
          ? ((t[i++] = 224 | (e >>> 12)), (t[i++] = 128 | ((e >>> 6) & 63)), (t[i++] = 128 | (63 & e)))
          : ((t[i++] = 240 | (e >>> 18)),
            (t[i++] = 128 | ((e >>> 12) & 63)),
            (t[i++] = 128 | ((e >>> 6) & 63)),
            (t[i++] = 128 | (63 & e)));
    return t;
  }),
  (_t.buf2binstring = function (r) {
    return vv(r, r.length);
  }),
  (_t.binstring2buf = function (r) {
    for (var t = new ra.Buf8(r.length), e = 0, n = t.length; e < n; e++) t[e] = r.charCodeAt(e);
    return t;
  }),
  (_t.buf2string = function (r, t) {
    var e,
      n,
      a,
      i,
      o = t || r.length,
      s = new Array(2 * o);
    for (n = 0, e = 0; e < o; )
      if ((a = r[e++]) < 128) s[n++] = a;
      else if ((i = an[a]) > 4) (s[n++] = 65533), (e += i - 1);
      else {
        for (a &= i === 2 ? 31 : i === 3 ? 15 : 7; i > 1 && e < o; ) (a = (a << 6) | (63 & r[e++])), i--;
        i > 1
          ? (s[n++] = 65533)
          : a < 65536
          ? (s[n++] = a)
          : ((a -= 65536), (s[n++] = 55296 | ((a >> 10) & 1023)), (s[n++] = 56320 | (1023 & a)));
      }
    return vv(s, n);
  }),
  (_t.utf8border = function (r, t) {
    var e;
    for ((t = t || r.length) > r.length && (t = r.length), e = t - 1; e >= 0 && (192 & r[e]) == 128; ) e--;
    return e < 0 || e === 0 ? t : e + an[r[e]] > t ? e : t;
  });
var ly = function () {
    (this.input = null),
      (this.next_in = 0),
      (this.avail_in = 0),
      (this.total_in = 0),
      (this.output = null),
      (this.next_out = 0),
      (this.avail_out = 0),
      (this.total_out = 0),
      (this.msg = ''),
      (this.state = null),
      (this.data_type = 2),
      (this.adler = 0);
  },
  dn = zr,
  on = tt,
  Ms = _t,
  Fs = du,
  w_ = ly,
  cy = Object.prototype.toString;
function kt(r) {
  if (!(this instanceof kt)) return new kt(r);
  this.options = on.assign(
    { level: -1, method: 8, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: 0, to: '' },
    r || {}
  );
  var t = this.options;
  t.raw && t.windowBits > 0
    ? (t.windowBits = -t.windowBits)
    : t.gzip && t.windowBits > 0 && t.windowBits < 16 && (t.windowBits += 16),
    (this.err = 0),
    (this.msg = ''),
    (this.ended = !1),
    (this.chunks = []),
    (this.strm = new w_()),
    (this.strm.avail_out = 0);
  var e = dn.deflateInit2(this.strm, t.level, t.method, t.windowBits, t.memLevel, t.strategy);
  if (e !== 0) throw new Error(Fs[e]);
  if ((t.header && dn.deflateSetHeader(this.strm, t.header), t.dictionary)) {
    var n;
    if (
      ((n =
        typeof t.dictionary == 'string'
          ? Ms.string2buf(t.dictionary)
          : cy.call(t.dictionary) === '[object ArrayBuffer]'
          ? new Uint8Array(t.dictionary)
          : t.dictionary),
      (e = dn.deflateSetDictionary(this.strm, n)) !== 0)
    )
      throw new Error(Fs[e]);
    this._dict_set = !0;
  }
}
function vs(r, t) {
  var e = new kt(t);
  if ((e.push(r, !0), e.err)) throw e.msg || Fs[e.err];
  return e.result;
}
(kt.prototype.push = function (r, t) {
  var e,
    n,
    a = this.strm,
    i = this.options.chunkSize;
  if (this.ended) return !1;
  (n = t === ~~t ? t : t === !0 ? 4 : 0),
    typeof r == 'string'
      ? (a.input = Ms.string2buf(r))
      : cy.call(r) === '[object ArrayBuffer]'
      ? (a.input = new Uint8Array(r))
      : (a.input = r),
    (a.next_in = 0),
    (a.avail_in = a.input.length);
  do {
    if (
      (a.avail_out === 0 && ((a.output = new on.Buf8(i)), (a.next_out = 0), (a.avail_out = i)),
      (e = dn.deflate(a, n)) !== 1 && e !== 0)
    )
      return this.onEnd(e), (this.ended = !0), !1;
    (a.avail_out !== 0 && (a.avail_in !== 0 || (n !== 4 && n !== 2))) ||
      (this.options.to === 'string'
        ? this.onData(Ms.buf2binstring(on.shrinkBuf(a.output, a.next_out)))
        : this.onData(on.shrinkBuf(a.output, a.next_out)));
  } while ((a.avail_in > 0 || a.avail_out === 0) && e !== 1);
  return n === 4
    ? ((e = dn.deflateEnd(this.strm)), this.onEnd(e), (this.ended = !0), e === 0)
    : n !== 2 || (this.onEnd(0), (a.avail_out = 0), !0);
}),
  (kt.prototype.onData = function (r) {
    this.chunks.push(r);
  }),
  (kt.prototype.onEnd = function (r) {
    r === 0 &&
      (this.options.to === 'string'
        ? (this.result = this.chunks.join(''))
        : (this.result = on.flattenChunks(this.chunks))),
      (this.chunks = []),
      (this.err = r),
      (this.msg = this.strm.msg);
  }),
  (tn.Deflate = kt),
  (tn.deflate = vs),
  (tn.deflateRaw = function (r, t) {
    return ((t = t || {}).raw = !0), vs(r, t);
  }),
  (tn.gzip = function (r, t) {
    return ((t = t || {}).gzip = !0), vs(r, t);
  });
var sn = {},
  Fr = {},
  mv = tt,
  Dn = 15,
  S_ = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
    0, 0,
  ],
  k_ = [
    16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16,
    72, 78,
  ],
  E_ = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
    8193, 12289, 16385, 24577, 0, 0,
  ],
  A_ = [
    16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29,
    29, 64, 64,
  ],
  kr = tt,
  ms = ry,
  Ur = ty,
  R_ = function (t, e) {
    var n, a, i, o, s, u, l, c, h, d, f, p, v, y, E, _, g, b, A, w, T, P, x, C, q;
    (n = t.state),
      (a = t.next_in),
      (C = t.input),
      (i = a + (t.avail_in - 5)),
      (o = t.next_out),
      (q = t.output),
      (s = o - (e - t.avail_out)),
      (u = o + (t.avail_out - 257)),
      (l = n.dmax),
      (c = n.wsize),
      (h = n.whave),
      (d = n.wnext),
      (f = n.window),
      (p = n.hold),
      (v = n.bits),
      (y = n.lencode),
      (E = n.distcode),
      (_ = (1 << n.lenbits) - 1),
      (g = (1 << n.distbits) - 1);
    e: do {
      v < 15 && ((p += C[a++] << v), (v += 8), (p += C[a++] << v), (v += 8)), (b = y[p & _]);
      r: for (;;) {
        if (((p >>>= A = b >>> 24), (v -= A), (A = (b >>> 16) & 255) === 0)) q[o++] = 65535 & b;
        else {
          if (!(16 & A)) {
            if (64 & A) {
              if (32 & A) {
                n.mode = 12;
                break e;
              }
              (t.msg = 'invalid literal/length code'), (n.mode = 30);
              break e;
            }
            b = y[(65535 & b) + (p & ((1 << A) - 1))];
            continue r;
          }
          for (
            w = 65535 & b,
              (A &= 15) && (v < A && ((p += C[a++] << v), (v += 8)), (w += p & ((1 << A) - 1)), (p >>>= A), (v -= A)),
              v < 15 && ((p += C[a++] << v), (v += 8), (p += C[a++] << v), (v += 8)),
              b = E[p & g];
            ;

          ) {
            if (((p >>>= A = b >>> 24), (v -= A), 16 & (A = (b >>> 16) & 255))) {
              if (
                ((T = 65535 & b),
                v < (A &= 15) && ((p += C[a++] << v), (v += 8) < A && ((p += C[a++] << v), (v += 8))),
                (T += p & ((1 << A) - 1)) > l)
              ) {
                (t.msg = 'invalid distance too far back'), (n.mode = 30);
                break e;
              }
              if (((p >>>= A), (v -= A), T > (A = o - s))) {
                if ((A = T - A) > h && n.sane) {
                  (t.msg = 'invalid distance too far back'), (n.mode = 30);
                  break e;
                }
                if (((P = 0), (x = f), d === 0)) {
                  if (((P += c - A), A < w)) {
                    w -= A;
                    do q[o++] = f[P++];
                    while (--A);
                    (P = o - T), (x = q);
                  }
                } else if (d < A) {
                  if (((P += c + d - A), (A -= d) < w)) {
                    w -= A;
                    do q[o++] = f[P++];
                    while (--A);
                    if (((P = 0), d < w)) {
                      w -= A = d;
                      do q[o++] = f[P++];
                      while (--A);
                      (P = o - T), (x = q);
                    }
                  }
                } else if (((P += d - A), A < w)) {
                  w -= A;
                  do q[o++] = f[P++];
                  while (--A);
                  (P = o - T), (x = q);
                }
                for (; w > 2; ) (q[o++] = x[P++]), (q[o++] = x[P++]), (q[o++] = x[P++]), (w -= 3);
                w && ((q[o++] = x[P++]), w > 1 && (q[o++] = x[P++]));
              } else {
                P = o - T;
                do (q[o++] = q[P++]), (q[o++] = q[P++]), (q[o++] = q[P++]), (w -= 3);
                while (w > 2);
                w && ((q[o++] = q[P++]), w > 1 && (q[o++] = q[P++]));
              }
              break;
            }
            if (64 & A) {
              (t.msg = 'invalid distance code'), (n.mode = 30);
              break e;
            }
            b = E[(65535 & b) + (p & ((1 << A) - 1))];
          }
        }
        break;
      }
    } while (a < i && o < u);
    (a -= w = v >> 3),
      (p &= (1 << (v -= w << 3)) - 1),
      (t.next_in = a),
      (t.next_out = o),
      (t.avail_in = a < i ? i - a + 5 : 5 - (a - i)),
      (t.avail_out = o < u ? u - o + 257 : 257 - (o - u)),
      (n.hold = p),
      (n.bits = v);
  },
  pn = function (t, e, n, a, i, o, s, u) {
    var l,
      c,
      h,
      d,
      f,
      p,
      v,
      y,
      E,
      _ = u.bits,
      g = 0,
      b = 0,
      A = 0,
      w = 0,
      T = 0,
      P = 0,
      x = 0,
      C = 0,
      q = 0,
      L = 0,
      ae = null,
      te = 0,
      k = new mv.Buf16(16),
      m = new mv.Buf16(16),
      R = null,
      I = 0;
    for (g = 0; g <= Dn; g++) k[g] = 0;
    for (b = 0; b < a; b++) k[e[n + b]]++;
    for (T = _, w = Dn; w >= 1 && k[w] === 0; w--);
    if ((T > w && (T = w), w === 0)) return (i[o++] = 20971520), (i[o++] = 20971520), (u.bits = 1), 0;
    for (A = 1; A < w && k[A] === 0; A++);
    for (T < A && (T = A), C = 1, g = 1; g <= Dn; g++) if (((C <<= 1), (C -= k[g]) < 0)) return -1;
    if (C > 0 && (t === 0 || w !== 1)) return -1;
    for (m[1] = 0, g = 1; g < Dn; g++) m[g + 1] = m[g] + k[g];
    for (b = 0; b < a; b++) e[n + b] !== 0 && (s[m[e[n + b]]++] = b);
    if (
      (t === 0
        ? ((ae = R = s), (p = 19))
        : t === 1
        ? ((ae = S_), (te -= 257), (R = k_), (I -= 257), (p = 256))
        : ((ae = E_), (R = A_), (p = -1)),
      (L = 0),
      (b = 0),
      (g = A),
      (f = o),
      (P = T),
      (x = 0),
      (h = -1),
      (d = (q = 1 << T) - 1),
      (t === 1 && q > 852) || (t === 2 && q > 592))
    )
      return 1;
    for (;;) {
      (v = g - x),
        s[b] < p ? ((y = 0), (E = s[b])) : s[b] > p ? ((y = R[I + s[b]]), (E = ae[te + s[b]])) : ((y = 96), (E = 0)),
        (l = 1 << (g - x)),
        (A = c = 1 << P);
      do i[f + (L >> x) + (c -= l)] = (v << 24) | (y << 16) | E;
      while (c !== 0);
      for (l = 1 << (g - 1); L & l; ) l >>= 1;
      if ((l !== 0 ? ((L &= l - 1), (L += l)) : (L = 0), b++, --k[g] == 0)) {
        if (g === w) break;
        g = e[n + s[b]];
      }
      if (g > T && (L & d) !== h) {
        for (x === 0 && (x = T), f += A, C = 1 << (P = g - x); P + x < w && !((C -= k[P + x]) <= 0); ) P++, (C <<= 1);
        if (((q += 1 << P), (t === 1 && q > 852) || (t === 2 && q > 592))) return 1;
        i[(h = L & d)] = (T << 24) | (P << 16) | (f - o);
      }
    }
    return L !== 0 && (i[f + L] = ((g - x) << 24) | (64 << 16)), (u.bits = T), 0;
  },
  Br = -2,
  Kr = 12,
  je = 30;
function yv(r) {
  return ((r >>> 24) & 255) + ((r >>> 8) & 65280) + ((65280 & r) << 8) + ((255 & r) << 24);
}
function T_() {
  (this.mode = 0),
    (this.last = !1),
    (this.wrap = 0),
    (this.havedict = !1),
    (this.flags = 0),
    (this.dmax = 0),
    (this.check = 0),
    (this.total = 0),
    (this.head = null),
    (this.wbits = 0),
    (this.wsize = 0),
    (this.whave = 0),
    (this.wnext = 0),
    (this.window = null),
    (this.hold = 0),
    (this.bits = 0),
    (this.length = 0),
    (this.offset = 0),
    (this.extra = 0),
    (this.lencode = null),
    (this.distcode = null),
    (this.lenbits = 0),
    (this.distbits = 0),
    (this.ncode = 0),
    (this.nlen = 0),
    (this.ndist = 0),
    (this.have = 0),
    (this.next = null),
    (this.lens = new kr.Buf16(320)),
    (this.work = new kr.Buf16(288)),
    (this.lendyn = null),
    (this.distdyn = null),
    (this.sane = 0),
    (this.back = 0),
    (this.was = 0);
}
function fy(r) {
  var t;
  return r && r.state
    ? ((t = r.state),
      (r.total_in = r.total_out = t.total = 0),
      (r.msg = ''),
      t.wrap && (r.adler = 1 & t.wrap),
      (t.mode = 1),
      (t.last = 0),
      (t.havedict = 0),
      (t.dmax = 32768),
      (t.head = null),
      (t.hold = 0),
      (t.bits = 0),
      (t.lencode = t.lendyn = new kr.Buf32(852)),
      (t.distcode = t.distdyn = new kr.Buf32(592)),
      (t.sane = 1),
      (t.back = -1),
      0)
    : Br;
}
function hy(r) {
  var t;
  return r && r.state ? (((t = r.state).wsize = 0), (t.whave = 0), (t.wnext = 0), fy(r)) : Br;
}
function dy(r, t) {
  var e, n;
  return r && r.state
    ? ((n = r.state),
      t < 0 ? ((e = 0), (t = -t)) : ((e = 1 + (t >> 4)), t < 48 && (t &= 15)),
      t && (t < 8 || t > 15)
        ? Br
        : (n.window !== null && n.wbits !== t && (n.window = null), (n.wrap = e), (n.wbits = t), hy(r)))
    : Br;
}
function gv(r, t) {
  var e, n;
  return r ? ((n = new T_()), (r.state = n), (n.window = null), (e = dy(r, t)) !== 0 && (r.state = null), e) : Br;
}
var ys,
  gs,
  bv = !0;
function x_(r) {
  if (bv) {
    var t;
    for (ys = new kr.Buf32(512), gs = new kr.Buf32(32), t = 0; t < 144; ) r.lens[t++] = 8;
    for (; t < 256; ) r.lens[t++] = 9;
    for (; t < 280; ) r.lens[t++] = 7;
    for (; t < 288; ) r.lens[t++] = 8;
    for (pn(1, r.lens, 0, 288, ys, 0, r.work, { bits: 9 }), t = 0; t < 32; ) r.lens[t++] = 5;
    pn(2, r.lens, 0, 32, gs, 0, r.work, { bits: 5 }), (bv = !1);
  }
  (r.lencode = ys), (r.lenbits = 9), (r.distcode = gs), (r.distbits = 5);
}
function _v(r, t, e, n) {
  var a,
    i = r.state;
  return (
    i.window === null && ((i.wsize = 1 << i.wbits), (i.wnext = 0), (i.whave = 0), (i.window = new kr.Buf8(i.wsize))),
    n >= i.wsize
      ? (kr.arraySet(i.window, t, e - i.wsize, i.wsize, 0), (i.wnext = 0), (i.whave = i.wsize))
      : ((a = i.wsize - i.wnext) > n && (a = n),
        kr.arraySet(i.window, t, e - n, a, i.wnext),
        (n -= a)
          ? (kr.arraySet(i.window, t, e - n, n, 0), (i.wnext = n), (i.whave = i.wsize))
          : ((i.wnext += a), i.wnext === i.wsize && (i.wnext = 0), i.whave < i.wsize && (i.whave += a))),
    0
  );
}
(Fr.inflateReset = hy),
  (Fr.inflateReset2 = dy),
  (Fr.inflateResetKeep = fy),
  (Fr.inflateInit = function (r) {
    return gv(r, 15);
  }),
  (Fr.inflateInit2 = gv),
  (Fr.inflate = function (r, t) {
    var e,
      n,
      a,
      i,
      o,
      s,
      u,
      l,
      c,
      h,
      d,
      f,
      p,
      v,
      y,
      E,
      _,
      g,
      b,
      A,
      w,
      T,
      P,
      x,
      C = 0,
      q = new kr.Buf8(4),
      L = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    if (!r || !r.state || !r.output || (!r.input && r.avail_in !== 0)) return Br;
    (e = r.state).mode === Kr && (e.mode = 13),
      (o = r.next_out),
      (a = r.output),
      (u = r.avail_out),
      (i = r.next_in),
      (n = r.input),
      (s = r.avail_in),
      (l = e.hold),
      (c = e.bits),
      (h = s),
      (d = u),
      (T = 0);
    e: for (;;)
      switch (e.mode) {
        case 1:
          if (e.wrap === 0) {
            e.mode = 13;
            break;
          }
          for (; c < 16; ) {
            if (s === 0) break e;
            s--, (l += n[i++] << c), (c += 8);
          }
          if (2 & e.wrap && l === 35615) {
            (e.check = 0),
              (q[0] = 255 & l),
              (q[1] = (l >>> 8) & 255),
              (e.check = Ur(e.check, q, 2, 0)),
              (l = 0),
              (c = 0),
              (e.mode = 2);
            break;
          }
          if (((e.flags = 0), e.head && (e.head.done = !1), !(1 & e.wrap) || (((255 & l) << 8) + (l >> 8)) % 31)) {
            (r.msg = 'incorrect header check'), (e.mode = je);
            break;
          }
          if ((15 & l) != 8) {
            (r.msg = 'unknown compression method'), (e.mode = je);
            break;
          }
          if (((c -= 4), (w = 8 + (15 & (l >>>= 4))), e.wbits === 0)) e.wbits = w;
          else if (w > e.wbits) {
            (r.msg = 'invalid window size'), (e.mode = je);
            break;
          }
          (e.dmax = 1 << w), (r.adler = e.check = 1), (e.mode = 512 & l ? 10 : Kr), (l = 0), (c = 0);
          break;
        case 2:
          for (; c < 16; ) {
            if (s === 0) break e;
            s--, (l += n[i++] << c), (c += 8);
          }
          if (((e.flags = l), (255 & e.flags) != 8)) {
            (r.msg = 'unknown compression method'), (e.mode = je);
            break;
          }
          if (57344 & e.flags) {
            (r.msg = 'unknown header flags set'), (e.mode = je);
            break;
          }
          e.head && (e.head.text = (l >> 8) & 1),
            512 & e.flags && ((q[0] = 255 & l), (q[1] = (l >>> 8) & 255), (e.check = Ur(e.check, q, 2, 0))),
            (l = 0),
            (c = 0),
            (e.mode = 3);
        case 3:
          for (; c < 32; ) {
            if (s === 0) break e;
            s--, (l += n[i++] << c), (c += 8);
          }
          e.head && (e.head.time = l),
            512 & e.flags &&
              ((q[0] = 255 & l),
              (q[1] = (l >>> 8) & 255),
              (q[2] = (l >>> 16) & 255),
              (q[3] = (l >>> 24) & 255),
              (e.check = Ur(e.check, q, 4, 0))),
            (l = 0),
            (c = 0),
            (e.mode = 4);
        case 4:
          for (; c < 16; ) {
            if (s === 0) break e;
            s--, (l += n[i++] << c), (c += 8);
          }
          e.head && ((e.head.xflags = 255 & l), (e.head.os = l >> 8)),
            512 & e.flags && ((q[0] = 255 & l), (q[1] = (l >>> 8) & 255), (e.check = Ur(e.check, q, 2, 0))),
            (l = 0),
            (c = 0),
            (e.mode = 5);
        case 5:
          if (1024 & e.flags) {
            for (; c < 16; ) {
              if (s === 0) break e;
              s--, (l += n[i++] << c), (c += 8);
            }
            (e.length = l),
              e.head && (e.head.extra_len = l),
              512 & e.flags && ((q[0] = 255 & l), (q[1] = (l >>> 8) & 255), (e.check = Ur(e.check, q, 2, 0))),
              (l = 0),
              (c = 0);
          } else e.head && (e.head.extra = null);
          e.mode = 6;
        case 6:
          if (
            1024 & e.flags &&
            ((f = e.length) > s && (f = s),
            f &&
              (e.head &&
                ((w = e.head.extra_len - e.length),
                e.head.extra || (e.head.extra = new Array(e.head.extra_len)),
                kr.arraySet(e.head.extra, n, i, f, w)),
              512 & e.flags && (e.check = Ur(e.check, n, f, i)),
              (s -= f),
              (i += f),
              (e.length -= f)),
            e.length)
          )
            break e;
          (e.length = 0), (e.mode = 7);
        case 7:
          if (2048 & e.flags) {
            if (s === 0) break e;
            f = 0;
            do (w = n[i + f++]), e.head && w && e.length < 65536 && (e.head.name += String.fromCharCode(w));
            while (w && f < s);
            if ((512 & e.flags && (e.check = Ur(e.check, n, f, i)), (s -= f), (i += f), w)) break e;
          } else e.head && (e.head.name = null);
          (e.length = 0), (e.mode = 8);
        case 8:
          if (4096 & e.flags) {
            if (s === 0) break e;
            f = 0;
            do (w = n[i + f++]), e.head && w && e.length < 65536 && (e.head.comment += String.fromCharCode(w));
            while (w && f < s);
            if ((512 & e.flags && (e.check = Ur(e.check, n, f, i)), (s -= f), (i += f), w)) break e;
          } else e.head && (e.head.comment = null);
          e.mode = 9;
        case 9:
          if (512 & e.flags) {
            for (; c < 16; ) {
              if (s === 0) break e;
              s--, (l += n[i++] << c), (c += 8);
            }
            if (l !== (65535 & e.check)) {
              (r.msg = 'header crc mismatch'), (e.mode = je);
              break;
            }
            (l = 0), (c = 0);
          }
          e.head && ((e.head.hcrc = (e.flags >> 9) & 1), (e.head.done = !0)), (r.adler = e.check = 0), (e.mode = Kr);
          break;
        case 10:
          for (; c < 32; ) {
            if (s === 0) break e;
            s--, (l += n[i++] << c), (c += 8);
          }
          (r.adler = e.check = yv(l)), (l = 0), (c = 0), (e.mode = 11);
        case 11:
          if (e.havedict === 0)
            return (
              (r.next_out = o), (r.avail_out = u), (r.next_in = i), (r.avail_in = s), (e.hold = l), (e.bits = c), 2
            );
          (r.adler = e.check = 1), (e.mode = Kr);
        case Kr:
          if (t === 5 || t === 6) break e;
        case 13:
          if (e.last) {
            (l >>>= 7 & c), (c -= 7 & c), (e.mode = 27);
            break;
          }
          for (; c < 3; ) {
            if (s === 0) break e;
            s--, (l += n[i++] << c), (c += 8);
          }
          switch (((e.last = 1 & l), (c -= 1), 3 & (l >>>= 1))) {
            case 0:
              e.mode = 14;
              break;
            case 1:
              if ((x_(e), (e.mode = 20), t === 6)) {
                (l >>>= 2), (c -= 2);
                break e;
              }
              break;
            case 2:
              e.mode = 17;
              break;
            case 3:
              (r.msg = 'invalid block type'), (e.mode = je);
          }
          (l >>>= 2), (c -= 2);
          break;
        case 14:
          for (l >>>= 7 & c, c -= 7 & c; c < 32; ) {
            if (s === 0) break e;
            s--, (l += n[i++] << c), (c += 8);
          }
          if ((65535 & l) != ((l >>> 16) ^ 65535)) {
            (r.msg = 'invalid stored block lengths'), (e.mode = je);
            break;
          }
          if (((e.length = 65535 & l), (l = 0), (c = 0), (e.mode = 15), t === 6)) break e;
        case 15:
          e.mode = 16;
        case 16:
          if ((f = e.length)) {
            if ((f > s && (f = s), f > u && (f = u), f === 0)) break e;
            kr.arraySet(a, n, i, f, o), (s -= f), (i += f), (u -= f), (o += f), (e.length -= f);
            break;
          }
          e.mode = Kr;
          break;
        case 17:
          for (; c < 14; ) {
            if (s === 0) break e;
            s--, (l += n[i++] << c), (c += 8);
          }
          if (
            ((e.nlen = 257 + (31 & l)),
            (l >>>= 5),
            (c -= 5),
            (e.ndist = 1 + (31 & l)),
            (l >>>= 5),
            (c -= 5),
            (e.ncode = 4 + (15 & l)),
            (l >>>= 4),
            (c -= 4),
            e.nlen > 286 || e.ndist > 30)
          ) {
            (r.msg = 'too many length or distance symbols'), (e.mode = je);
            break;
          }
          (e.have = 0), (e.mode = 18);
        case 18:
          for (; e.have < e.ncode; ) {
            for (; c < 3; ) {
              if (s === 0) break e;
              s--, (l += n[i++] << c), (c += 8);
            }
            (e.lens[L[e.have++]] = 7 & l), (l >>>= 3), (c -= 3);
          }
          for (; e.have < 19; ) e.lens[L[e.have++]] = 0;
          if (
            ((e.lencode = e.lendyn),
            (e.lenbits = 7),
            (P = { bits: e.lenbits }),
            (T = pn(0, e.lens, 0, 19, e.lencode, 0, e.work, P)),
            (e.lenbits = P.bits),
            T)
          ) {
            (r.msg = 'invalid code lengths set'), (e.mode = je);
            break;
          }
          (e.have = 0), (e.mode = 19);
        case 19:
          for (; e.have < e.nlen + e.ndist; ) {
            for (
              ;
              (E = ((C = e.lencode[l & ((1 << e.lenbits) - 1)]) >>> 16) & 255), (_ = 65535 & C), !((y = C >>> 24) <= c);

            ) {
              if (s === 0) break e;
              s--, (l += n[i++] << c), (c += 8);
            }
            if (_ < 16) (l >>>= y), (c -= y), (e.lens[e.have++] = _);
            else {
              if (_ === 16) {
                for (x = y + 2; c < x; ) {
                  if (s === 0) break e;
                  s--, (l += n[i++] << c), (c += 8);
                }
                if (((l >>>= y), (c -= y), e.have === 0)) {
                  (r.msg = 'invalid bit length repeat'), (e.mode = je);
                  break;
                }
                (w = e.lens[e.have - 1]), (f = 3 + (3 & l)), (l >>>= 2), (c -= 2);
              } else if (_ === 17) {
                for (x = y + 3; c < x; ) {
                  if (s === 0) break e;
                  s--, (l += n[i++] << c), (c += 8);
                }
                (c -= y), (w = 0), (f = 3 + (7 & (l >>>= y))), (l >>>= 3), (c -= 3);
              } else {
                for (x = y + 7; c < x; ) {
                  if (s === 0) break e;
                  s--, (l += n[i++] << c), (c += 8);
                }
                (c -= y), (w = 0), (f = 11 + (127 & (l >>>= y))), (l >>>= 7), (c -= 7);
              }
              if (e.have + f > e.nlen + e.ndist) {
                (r.msg = 'invalid bit length repeat'), (e.mode = je);
                break;
              }
              for (; f--; ) e.lens[e.have++] = w;
            }
          }
          if (e.mode === je) break;
          if (e.lens[256] === 0) {
            (r.msg = 'invalid code -- missing end-of-block'), (e.mode = je);
            break;
          }
          if (
            ((e.lenbits = 9),
            (P = { bits: e.lenbits }),
            (T = pn(1, e.lens, 0, e.nlen, e.lencode, 0, e.work, P)),
            (e.lenbits = P.bits),
            T)
          ) {
            (r.msg = 'invalid literal/lengths set'), (e.mode = je);
            break;
          }
          if (
            ((e.distbits = 6),
            (e.distcode = e.distdyn),
            (P = { bits: e.distbits }),
            (T = pn(2, e.lens, e.nlen, e.ndist, e.distcode, 0, e.work, P)),
            (e.distbits = P.bits),
            T)
          ) {
            (r.msg = 'invalid distances set'), (e.mode = je);
            break;
          }
          if (((e.mode = 20), t === 6)) break e;
        case 20:
          e.mode = 21;
        case 21:
          if (s >= 6 && u >= 258) {
            (r.next_out = o),
              (r.avail_out = u),
              (r.next_in = i),
              (r.avail_in = s),
              (e.hold = l),
              (e.bits = c),
              R_(r, d),
              (o = r.next_out),
              (a = r.output),
              (u = r.avail_out),
              (i = r.next_in),
              (n = r.input),
              (s = r.avail_in),
              (l = e.hold),
              (c = e.bits),
              e.mode === Kr && (e.back = -1);
            break;
          }
          for (
            e.back = 0;
            (E = ((C = e.lencode[l & ((1 << e.lenbits) - 1)]) >>> 16) & 255), (_ = 65535 & C), !((y = C >>> 24) <= c);

          ) {
            if (s === 0) break e;
            s--, (l += n[i++] << c), (c += 8);
          }
          if (E && !(240 & E)) {
            for (
              g = y, b = E, A = _;
              (E = ((C = e.lencode[A + ((l & ((1 << (g + b)) - 1)) >> g)]) >>> 16) & 255),
                (_ = 65535 & C),
                !(g + (y = C >>> 24) <= c);

            ) {
              if (s === 0) break e;
              s--, (l += n[i++] << c), (c += 8);
            }
            (l >>>= g), (c -= g), (e.back += g);
          }
          if (((l >>>= y), (c -= y), (e.back += y), (e.length = _), E === 0)) {
            e.mode = 26;
            break;
          }
          if (32 & E) {
            (e.back = -1), (e.mode = Kr);
            break;
          }
          if (64 & E) {
            (r.msg = 'invalid literal/length code'), (e.mode = je);
            break;
          }
          (e.extra = 15 & E), (e.mode = 22);
        case 22:
          if (e.extra) {
            for (x = e.extra; c < x; ) {
              if (s === 0) break e;
              s--, (l += n[i++] << c), (c += 8);
            }
            (e.length += l & ((1 << e.extra) - 1)), (l >>>= e.extra), (c -= e.extra), (e.back += e.extra);
          }
          (e.was = e.length), (e.mode = 23);
        case 23:
          for (
            ;
            (E = ((C = e.distcode[l & ((1 << e.distbits) - 1)]) >>> 16) & 255), (_ = 65535 & C), !((y = C >>> 24) <= c);

          ) {
            if (s === 0) break e;
            s--, (l += n[i++] << c), (c += 8);
          }
          if (!(240 & E)) {
            for (
              g = y, b = E, A = _;
              (E = ((C = e.distcode[A + ((l & ((1 << (g + b)) - 1)) >> g)]) >>> 16) & 255),
                (_ = 65535 & C),
                !(g + (y = C >>> 24) <= c);

            ) {
              if (s === 0) break e;
              s--, (l += n[i++] << c), (c += 8);
            }
            (l >>>= g), (c -= g), (e.back += g);
          }
          if (((l >>>= y), (c -= y), (e.back += y), 64 & E)) {
            (r.msg = 'invalid distance code'), (e.mode = je);
            break;
          }
          (e.offset = _), (e.extra = 15 & E), (e.mode = 24);
        case 24:
          if (e.extra) {
            for (x = e.extra; c < x; ) {
              if (s === 0) break e;
              s--, (l += n[i++] << c), (c += 8);
            }
            (e.offset += l & ((1 << e.extra) - 1)), (l >>>= e.extra), (c -= e.extra), (e.back += e.extra);
          }
          if (e.offset > e.dmax) {
            (r.msg = 'invalid distance too far back'), (e.mode = je);
            break;
          }
          e.mode = 25;
        case 25:
          if (u === 0) break e;
          if (((f = d - u), e.offset > f)) {
            if ((f = e.offset - f) > e.whave && e.sane) {
              (r.msg = 'invalid distance too far back'), (e.mode = je);
              break;
            }
            f > e.wnext ? ((f -= e.wnext), (p = e.wsize - f)) : (p = e.wnext - f),
              f > e.length && (f = e.length),
              (v = e.window);
          } else (v = a), (p = o - e.offset), (f = e.length);
          f > u && (f = u), (u -= f), (e.length -= f);
          do a[o++] = v[p++];
          while (--f);
          e.length === 0 && (e.mode = 21);
          break;
        case 26:
          if (u === 0) break e;
          (a[o++] = e.length), u--, (e.mode = 21);
          break;
        case 27:
          if (e.wrap) {
            for (; c < 32; ) {
              if (s === 0) break e;
              s--, (l |= n[i++] << c), (c += 8);
            }
            if (
              ((d -= u),
              (r.total_out += d),
              (e.total += d),
              d && (r.adler = e.check = e.flags ? Ur(e.check, a, d, o - d) : ms(e.check, a, d, o - d)),
              (d = u),
              (e.flags ? l : yv(l)) !== e.check)
            ) {
              (r.msg = 'incorrect data check'), (e.mode = je);
              break;
            }
            (l = 0), (c = 0);
          }
          e.mode = 28;
        case 28:
          if (e.wrap && e.flags) {
            for (; c < 32; ) {
              if (s === 0) break e;
              s--, (l += n[i++] << c), (c += 8);
            }
            if (l !== (4294967295 & e.total)) {
              (r.msg = 'incorrect length check'), (e.mode = je);
              break;
            }
            (l = 0), (c = 0);
          }
          e.mode = 29;
        case 29:
          T = 1;
          break e;
        case je:
          T = -3;
          break e;
        case 31:
          return -4;
        default:
          return Br;
      }
    return (
      (r.next_out = o),
      (r.avail_out = u),
      (r.next_in = i),
      (r.avail_in = s),
      (e.hold = l),
      (e.bits = c),
      (e.wsize || (d !== r.avail_out && e.mode < je && (e.mode < 27 || t !== 4))) &&
        _v(r, r.output, r.next_out, d - r.avail_out),
      (h -= r.avail_in),
      (d -= r.avail_out),
      (r.total_in += h),
      (r.total_out += d),
      (e.total += d),
      e.wrap &&
        d &&
        (r.adler = e.check = e.flags ? Ur(e.check, a, d, r.next_out - d) : ms(e.check, a, d, r.next_out - d)),
      (r.data_type =
        e.bits + (e.last ? 64 : 0) + (e.mode === Kr ? 128 : 0) + (e.mode === 20 || e.mode === 15 ? 256 : 0)),
      ((h === 0 && d === 0) || t === 4) && T === 0 && (T = -5),
      T
    );
  }),
  (Fr.inflateEnd = function (r) {
    if (!r || !r.state) return Br;
    var t = r.state;
    return t.window && (t.window = null), (r.state = null), 0;
  }),
  (Fr.inflateGetHeader = function (r, t) {
    var e;
    return r && r.state && 2 & (e = r.state).wrap ? ((e.head = t), (t.done = !1), 0) : Br;
  }),
  (Fr.inflateSetDictionary = function (r, t) {
    var e,
      n = t.length;
    return r && r.state
      ? (e = r.state).wrap !== 0 && e.mode !== 11
        ? Br
        : e.mode === 11 && ms(1, t, n, 0) !== e.check
        ? -3
        : _v(r, t, n, n)
        ? ((e.mode = 31), -4)
        : ((e.havedict = 1), 0)
      : Br;
  }),
  (Fr.inflateInfo = 'pako inflate (from Nodeca project)');
var py = {
    Z_NO_FLUSH: 0,
    Z_PARTIAL_FLUSH: 1,
    Z_SYNC_FLUSH: 2,
    Z_FULL_FLUSH: 3,
    Z_FINISH: 4,
    Z_BLOCK: 5,
    Z_TREES: 6,
    Z_OK: 0,
    Z_STREAM_END: 1,
    Z_NEED_DICT: 2,
    Z_ERRNO: -1,
    Z_STREAM_ERROR: -2,
    Z_DATA_ERROR: -3,
    Z_BUF_ERROR: -5,
    Z_NO_COMPRESSION: 0,
    Z_BEST_SPEED: 1,
    Z_BEST_COMPRESSION: 9,
    Z_DEFAULT_COMPRESSION: -1,
    Z_FILTERED: 1,
    Z_HUFFMAN_ONLY: 2,
    Z_RLE: 3,
    Z_FIXED: 4,
    Z_DEFAULT_STRATEGY: 0,
    Z_BINARY: 0,
    Z_TEXT: 1,
    Z_UNKNOWN: 2,
    Z_DEFLATED: 8,
  },
  Lt = Fr,
  un = tt,
  $n = _t,
  Ve = py,
  qs = du,
  P_ = ly,
  I_ = function () {
    (this.text = 0),
      (this.time = 0),
      (this.xflags = 0),
      (this.os = 0),
      (this.extra = null),
      (this.extra_len = 0),
      (this.name = ''),
      (this.comment = ''),
      (this.hcrc = 0),
      (this.done = !1);
  },
  vy = Object.prototype.toString;
function Et(r) {
  if (!(this instanceof Et)) return new Et(r);
  this.options = un.assign({ chunkSize: 16384, windowBits: 0, to: '' }, r || {});
  var t = this.options;
  t.raw &&
    t.windowBits >= 0 &&
    t.windowBits < 16 &&
    ((t.windowBits = -t.windowBits), t.windowBits === 0 && (t.windowBits = -15)),
    !(t.windowBits >= 0 && t.windowBits < 16) || (r && r.windowBits) || (t.windowBits += 32),
    t.windowBits > 15 && t.windowBits < 48 && (15 & t.windowBits || (t.windowBits |= 15)),
    (this.err = 0),
    (this.msg = ''),
    (this.ended = !1),
    (this.chunks = []),
    (this.strm = new P_()),
    (this.strm.avail_out = 0);
  var e = Lt.inflateInit2(this.strm, t.windowBits);
  if (e !== Ve.Z_OK) throw new Error(qs[e]);
  if (
    ((this.header = new I_()),
    Lt.inflateGetHeader(this.strm, this.header),
    t.dictionary &&
      (typeof t.dictionary == 'string'
        ? (t.dictionary = $n.string2buf(t.dictionary))
        : vy.call(t.dictionary) === '[object ArrayBuffer]' && (t.dictionary = new Uint8Array(t.dictionary)),
      t.raw && (e = Lt.inflateSetDictionary(this.strm, t.dictionary)) !== Ve.Z_OK))
  )
    throw new Error(qs[e]);
}
function bs(r, t) {
  var e = new Et(t);
  if ((e.push(r, !0), e.err)) throw e.msg || qs[e.err];
  return e.result;
}
(Et.prototype.push = function (r, t) {
  var e,
    n,
    a,
    i,
    o,
    s = this.strm,
    u = this.options.chunkSize,
    l = this.options.dictionary,
    c = !1;
  if (this.ended) return !1;
  (n = t === ~~t ? t : t === !0 ? Ve.Z_FINISH : Ve.Z_NO_FLUSH),
    typeof r == 'string'
      ? (s.input = $n.binstring2buf(r))
      : vy.call(r) === '[object ArrayBuffer]'
      ? (s.input = new Uint8Array(r))
      : (s.input = r),
    (s.next_in = 0),
    (s.avail_in = s.input.length);
  do {
    if (
      (s.avail_out === 0 && ((s.output = new un.Buf8(u)), (s.next_out = 0), (s.avail_out = u)),
      (e = Lt.inflate(s, Ve.Z_NO_FLUSH)) === Ve.Z_NEED_DICT && l && (e = Lt.inflateSetDictionary(this.strm, l)),
      e === Ve.Z_BUF_ERROR && c === !0 && ((e = Ve.Z_OK), (c = !1)),
      e !== Ve.Z_STREAM_END && e !== Ve.Z_OK)
    )
      return this.onEnd(e), (this.ended = !0), !1;
    s.next_out &&
      ((s.avail_out !== 0 &&
        e !== Ve.Z_STREAM_END &&
        (s.avail_in !== 0 || (n !== Ve.Z_FINISH && n !== Ve.Z_SYNC_FLUSH))) ||
        (this.options.to === 'string'
          ? ((a = $n.utf8border(s.output, s.next_out)),
            (i = s.next_out - a),
            (o = $n.buf2string(s.output, a)),
            (s.next_out = i),
            (s.avail_out = u - i),
            i && un.arraySet(s.output, s.output, a, i, 0),
            this.onData(o))
          : this.onData(un.shrinkBuf(s.output, s.next_out)))),
      s.avail_in === 0 && s.avail_out === 0 && (c = !0);
  } while ((s.avail_in > 0 || s.avail_out === 0) && e !== Ve.Z_STREAM_END);
  return (
    e === Ve.Z_STREAM_END && (n = Ve.Z_FINISH),
    n === Ve.Z_FINISH
      ? ((e = Lt.inflateEnd(this.strm)), this.onEnd(e), (this.ended = !0), e === Ve.Z_OK)
      : n !== Ve.Z_SYNC_FLUSH || (this.onEnd(Ve.Z_OK), (s.avail_out = 0), !0)
  );
}),
  (Et.prototype.onData = function (r) {
    this.chunks.push(r);
  }),
  (Et.prototype.onEnd = function (r) {
    r === Ve.Z_OK &&
      (this.options.to === 'string'
        ? (this.result = this.chunks.join(''))
        : (this.result = un.flattenChunks(this.chunks))),
      (this.chunks = []),
      (this.err = r),
      (this.msg = this.strm.msg);
  }),
  (sn.Inflate = Et),
  (sn.inflate = bs),
  (sn.inflateRaw = function (r, t) {
    return ((t = t || {}).raw = !0), bs(r, t);
  }),
  (sn.ungzip = bs);
var my = {};
(0, tt.assign)(my, tn, sn, py);
var C_ = typeof Uint8Array < 'u' && typeof Uint16Array < 'u' && typeof Uint32Array < 'u',
  O_ = my,
  wv = We(),
  Kn = Nr,
  N_ = C_ ? 'uint8array' : 'array';
function vt(r, t) {
  Kn.call(this, 'FlateWorker/' + r),
    (this._pako = null),
    (this._pakoAction = r),
    (this._pakoOptions = t),
    (this.meta = {});
}
(Gn.magic = '\b\0'),
  wv.inherits(vt, Kn),
  (vt.prototype.processChunk = function (r) {
    (this.meta = r.meta), this._pako === null && this._createPako(), this._pako.push(wv.transformTo(N_, r.data), !1);
  }),
  (vt.prototype.flush = function () {
    Kn.prototype.flush.call(this), this._pako === null && this._createPako(), this._pako.push([], !0);
  }),
  (vt.prototype.cleanUp = function () {
    Kn.prototype.cleanUp.call(this), (this._pako = null);
  }),
  (vt.prototype._createPako = function () {
    this._pako = new O_[this._pakoAction]({ raw: !0, level: this._pakoOptions.level || -1 });
    var r = this;
    this._pako.onData = function (t) {
      r.push({ data: t, meta: r.meta });
    };
  }),
  (Gn.compressWorker = function (r) {
    return new vt('Deflate', r);
  }),
  (Gn.uncompressWorker = function () {
    return new vt('Inflate', {});
  });
var Sv = Nr;
(Qn.STORE = {
  magic: '\0\0',
  compressWorker: function () {
    return new Sv('STORE compression');
  },
  uncompressWorker: function () {
    return new Sv('STORE decompression');
  },
}),
  (Qn.DEFLATE = Gn);
var yy = {
    LOCAL_FILE_HEADER: 'PK',
    CENTRAL_FILE_HEADER: 'PK',
    CENTRAL_DIRECTORY_END: 'PK',
    ZIP64_CENTRAL_DIRECTORY_LOCATOR: 'PK\x07',
    ZIP64_CENTRAL_DIRECTORY_END: 'PK',
    DATA_DESCRIPTOR: 'PK\x07\b',
  },
  jt = We(),
  Ft = Nr,
  _s = Kt,
  kv = lu,
  ta = yy,
  Oe = function (t, e) {
    var n,
      a = '';
    for (n = 0; n < e; n++) (a += String.fromCharCode(255 & t)), (t >>>= 8);
    return a;
  },
  Ev = function (t, e, n, a, i, o) {
    var s,
      u,
      l = t.file,
      c = t.compression,
      h = o !== _s.utf8encode,
      d = jt.transformTo('string', o(l.name)),
      f = jt.transformTo('string', _s.utf8encode(l.name)),
      p = l.comment,
      v = jt.transformTo('string', o(p)),
      y = jt.transformTo('string', _s.utf8encode(p)),
      E = f.length !== l.name.length,
      _ = y.length !== p.length,
      g = '',
      b = '',
      A = '',
      w = l.dir,
      T = l.date,
      P = { crc32: 0, compressedSize: 0, uncompressedSize: 0 };
    (e && !n) ||
      ((P.crc32 = t.crc32), (P.compressedSize = t.compressedSize), (P.uncompressedSize = t.uncompressedSize));
    var x = 0;
    e && (x |= 8), h || (!E && !_) || (x |= 2048);
    var C,
      q,
      L,
      ae = 0,
      te = 0;
    w && (ae |= 16),
      i === 'UNIX'
        ? ((te = 798),
          (ae |= ((C = l.unixPermissions), (q = w), (L = C), C || (L = q ? 16893 : 33204), (65535 & L) << 16)))
        : ((te = 20), (ae |= 63 & (l.dosPermissions || 0))),
      (s = T.getUTCHours()),
      (s <<= 6),
      (s |= T.getUTCMinutes()),
      (s <<= 5),
      (s |= T.getUTCSeconds() / 2),
      (u = T.getUTCFullYear() - 1980),
      (u <<= 4),
      (u |= T.getUTCMonth() + 1),
      (u <<= 5),
      (u |= T.getUTCDate()),
      E && ((b = Oe(1, 1) + Oe(kv(d), 4) + f), (g += 'up' + Oe(b.length, 2) + b)),
      _ && ((A = Oe(1, 1) + Oe(kv(v), 4) + y), (g += 'uc' + Oe(A.length, 2) + A));
    var k = '';
    return (
      (k += `
\0`),
      (k += Oe(x, 2)),
      (k += c.magic),
      (k += Oe(s, 2)),
      (k += Oe(u, 2)),
      (k += Oe(P.crc32, 4)),
      (k += Oe(P.compressedSize, 4)),
      (k += Oe(P.uncompressedSize, 4)),
      (k += Oe(d.length, 2)),
      (k += Oe(g.length, 2)),
      {
        fileRecord: ta.LOCAL_FILE_HEADER + k + d + g,
        dirRecord:
          ta.CENTRAL_FILE_HEADER + Oe(te, 2) + k + Oe(v.length, 2) + '\0\0\0\0' + Oe(ae, 4) + Oe(a, 4) + d + g + v,
      }
    );
  },
  M_ = function (t) {
    return ta.DATA_DESCRIPTOR + Oe(t.crc32, 4) + Oe(t.compressedSize, 4) + Oe(t.uncompressedSize, 4);
  };
function qr(r, t, e, n) {
  Ft.call(this, 'ZipFileWorker'),
    (this.bytesWritten = 0),
    (this.zipComment = t),
    (this.zipPlatform = e),
    (this.encodeFileName = n),
    (this.streamFiles = r),
    (this.accumulate = !1),
    (this.contentBuffer = []),
    (this.dirRecords = []),
    (this.currentSourceOffset = 0),
    (this.entriesCount = 0),
    (this.currentFile = null),
    (this._sources = []);
}
jt.inherits(qr, Ft),
  (qr.prototype.push = function (r) {
    var t = r.meta.percent || 0,
      e = this.entriesCount,
      n = this._sources.length;
    this.accumulate
      ? this.contentBuffer.push(r)
      : ((this.bytesWritten += r.data.length),
        Ft.prototype.push.call(this, {
          data: r.data,
          meta: { currentFile: this.currentFile, percent: e ? (t + 100 * (e - n - 1)) / e : 100 },
        }));
  }),
  (qr.prototype.openedSource = function (r) {
    (this.currentSourceOffset = this.bytesWritten), (this.currentFile = r.file.name);
    var t = this.streamFiles && !r.file.dir;
    if (t) {
      var e = Ev(r, t, !1, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
      this.push({ data: e.fileRecord, meta: { percent: 0 } });
    } else this.accumulate = !0;
  }),
  (qr.prototype.closedSource = function (r) {
    this.accumulate = !1;
    var t = this.streamFiles && !r.file.dir,
      e = Ev(r, t, !0, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
    if ((this.dirRecords.push(e.dirRecord), t)) this.push({ data: M_(r), meta: { percent: 100 } });
    else
      for (this.push({ data: e.fileRecord, meta: { percent: 0 } }); this.contentBuffer.length; )
        this.push(this.contentBuffer.shift());
    this.currentFile = null;
  }),
  (qr.prototype.flush = function () {
    for (var r = this.bytesWritten, t = 0; t < this.dirRecords.length; t++)
      this.push({ data: this.dirRecords[t], meta: { percent: 100 } });
    var e = this.bytesWritten - r,
      n = (function (a, i, o, s, u) {
        var l = jt.transformTo('string', u(s));
        return ta.CENTRAL_DIRECTORY_END + '\0\0\0\0' + Oe(a, 2) + Oe(a, 2) + Oe(i, 4) + Oe(o, 4) + Oe(l.length, 2) + l;
      })(this.dirRecords.length, e, r, this.zipComment, this.encodeFileName);
    this.push({ data: n, meta: { percent: 100 } });
  }),
  (qr.prototype.prepareNextSource = function () {
    (this.previous = this._sources.shift()),
      this.openedSource(this.previous.streamInfo),
      this.isPaused ? this.previous.pause() : this.previous.resume();
  }),
  (qr.prototype.registerPrevious = function (r) {
    this._sources.push(r);
    var t = this;
    return (
      r.on('data', function (e) {
        t.processChunk(e);
      }),
      r.on('end', function () {
        t.closedSource(t.previous.streamInfo), t._sources.length ? t.prepareNextSource() : t.end();
      }),
      r.on('error', function (e) {
        t.error(e);
      }),
      this
    );
  }),
  (qr.prototype.resume = function () {
    return (
      !!Ft.prototype.resume.call(this) &&
      (!this.previous && this._sources.length
        ? (this.prepareNextSource(), !0)
        : this.previous || this._sources.length || this.generatedError
        ? void 0
        : (this.end(), !0))
    );
  }),
  (qr.prototype.error = function (r) {
    var t = this._sources;
    if (!Ft.prototype.error.call(this, r)) return !1;
    for (var e = 0; e < t.length; e++)
      try {
        t[e].error(r);
      } catch {}
    return !0;
  }),
  (qr.prototype.lock = function () {
    Ft.prototype.lock.call(this);
    for (var r = this._sources, t = 0; t < r.length; t++) r[t].lock();
  });
var F_ = Qn,
  q_ = qr;
Zm.generateWorker = function (r, t, e) {
  var n = new q_(t.streamFiles, e, t.platform, t.encodeFileName),
    a = 0;
  try {
    r.forEach(function (i, o) {
      a++;
      var s = (function (h, d) {
          var f = h || d,
            p = F_[f];
          if (!p) throw new Error(f + ' is not a valid compression method !');
          return p;
        })(o.options.compression, t.compression),
        u = o.options.compressionOptions || t.compressionOptions || {},
        l = o.dir,
        c = o.date;
      o._compressWorker(s, u)
        .withStreamInfo('file', {
          name: i,
          dir: l,
          date: c,
          comment: o.comment || '',
          unixPermissions: o.unixPermissions,
          dosPermissions: o.dosPermissions,
        })
        .pipe(n);
    }),
      (n.entriesCount = a);
  } catch (i) {
    n.error(i);
  }
  return n;
};
var B_ = We(),
  Zn = Nr;
function ln(r, t) {
  Zn.call(this, 'Nodejs stream input adapter for ' + r), (this._upstreamEnded = !1), this._bindStream(t);
}
B_.inherits(ln, Zn),
  (ln.prototype._bindStream = function (r) {
    var t = this;
    (this._stream = r),
      r.pause(),
      r
        .on('data', function (e) {
          t.push({ data: e, meta: { percent: 0 } });
        })
        .on('error', function (e) {
          t.isPaused ? (this.generatedError = e) : t.error(e);
        })
        .on('end', function () {
          t.isPaused ? (t._upstreamEnded = !0) : t.end();
        });
  }),
  (ln.prototype.pause = function () {
    return !!Zn.prototype.pause.call(this) && (this._stream.pause(), !0);
  }),
  (ln.prototype.resume = function () {
    return !!Zn.prototype.resume.call(this) && (this._upstreamEnded ? this.end() : this._stream.resume(), !0);
  });
var D_ = ln,
  j_ = Kt,
  vn = We(),
  gy = Nr,
  L_ = Hm,
  by = Gm,
  Av = cu,
  U_ = v_,
  z_ = Zm,
  Rv = va,
  W_ = D_,
  _y = function (t, e, n) {
    var a,
      i = vn.getTypeOf(e),
      o = vn.extend(n || {}, by);
    (o.date = o.date || new Date()),
      o.compression !== null && (o.compression = o.compression.toUpperCase()),
      typeof o.unixPermissions == 'string' && (o.unixPermissions = parseInt(o.unixPermissions, 8)),
      o.unixPermissions && 16384 & o.unixPermissions && (o.dir = !0),
      o.dosPermissions && 16 & o.dosPermissions && (o.dir = !0),
      o.dir && (t = wy(t)),
      o.createFolders && (a = H_(t)) && Sy.call(this, a, !0);
    var s = i === 'string' && o.binary === !1 && o.base64 === !1;
    (n && n.binary !== void 0) || (o.binary = !s),
      ((e instanceof Av && e.uncompressedSize === 0) || o.dir || !e || e.length === 0) &&
        ((o.base64 = !1), (o.binary = !0), (e = ''), (o.compression = 'STORE'), (i = 'string'));
    var u = null;
    u =
      e instanceof Av || e instanceof gy
        ? e
        : Rv.isNode && Rv.isStream(e)
        ? new W_(t, e)
        : vn.prepareContent(t, e, o.binary, o.optimizedBinaryString, o.base64);
    var l = new U_(t, u, o);
    this.files[t] = l;
  },
  H_ = function (t) {
    t.slice(-1) === '/' && (t = t.substring(0, t.length - 1));
    var e = t.lastIndexOf('/');
    return e > 0 ? t.substring(0, e) : '';
  },
  wy = function (t) {
    return t.slice(-1) !== '/' && (t += '/'), t;
  },
  Sy = function (t, e) {
    return (
      (e = e !== void 0 ? e : by.createFolders),
      (t = wy(t)),
      this.files[t] || _y.call(this, t, null, { dir: !0, createFolders: e }),
      this.files[t]
    );
  };
function Tv(r) {
  return Object.prototype.toString.call(r) === '[object RegExp]';
}
var G_ = {
    load: function () {
      throw new Error('This method has been removed in JSZip 3.0, please check the upgrade guide.');
    },
    forEach: function (t) {
      var e, n, a;
      for (e in this.files)
        (a = this.files[e]),
          (n = e.slice(this.root.length, e.length)) && e.slice(0, this.root.length) === this.root && t(n, a);
    },
    filter: function (t) {
      var e = [];
      return (
        this.forEach(function (n, a) {
          t(n, a) && e.push(a);
        }),
        e
      );
    },
    file: function (t, e, n) {
      if (arguments.length === 1) {
        if (Tv(t)) {
          var a = t;
          return this.filter(function (o, s) {
            return !s.dir && a.test(o);
          });
        }
        var i = this.files[this.root + t];
        return i && !i.dir ? i : null;
      }
      return (t = this.root + t), _y.call(this, t, e, n), this;
    },
    folder: function (t) {
      if (!t) return this;
      if (Tv(t))
        return this.filter(function (i, o) {
          return o.dir && t.test(i);
        });
      var e = this.root + t,
        n = Sy.call(this, e),
        a = this.clone();
      return (a.root = n.name), a;
    },
    remove: function (t) {
      t = this.root + t;
      var e = this.files[t];
      if ((e || (t.slice(-1) !== '/' && (t += '/'), (e = this.files[t])), e && !e.dir)) delete this.files[t];
      else
        for (
          var n = this.filter(function (i, o) {
              return o.name.slice(0, t.length) === t;
            }),
            a = 0;
          a < n.length;
          a++
        )
          delete this.files[n[a].name];
      return this;
    },
    generate: function () {
      throw new Error('This method has been removed in JSZip 3.0, please check the upgrade guide.');
    },
    generateInternalStream: function (t) {
      var e,
        n = {};
      try {
        if (
          (((n = vn.extend(t || {}, {
            streamFiles: !1,
            compression: 'STORE',
            compressionOptions: null,
            type: '',
            platform: 'DOS',
            comment: null,
            mimeType: 'application/zip',
            encodeFileName: j_.utf8encode,
          })).type = n.type.toLowerCase()),
          (n.compression = n.compression.toUpperCase()),
          n.type === 'binarystring' && (n.type = 'string'),
          !n.type)
        )
          throw new Error('No output type specified.');
        vn.checkSupport(n.type),
          (n.platform !== 'darwin' && n.platform !== 'freebsd' && n.platform !== 'linux' && n.platform !== 'sunos') ||
            (n.platform = 'UNIX'),
          n.platform === 'win32' && (n.platform = 'DOS');
        var a = n.comment || this.comment || '';
        e = z_.generateWorker(this, n, a);
      } catch (i) {
        (e = new gy('error')).error(i);
      }
      return new L_(e, n.type || 'string', n.mimeType);
    },
    generateAsync: function (t, e) {
      return this.generateInternalStream(t).accumulate(e);
    },
    generateNodeStream: function (t, e) {
      return (t = t || {}).type || (t.type = 'nodebuffer'), this.generateInternalStream(t).toNodejsStream(e);
    },
  },
  V_ = G_,
  $_ = We();
function ky(r) {
  (this.data = r), (this.length = r.length), (this.index = 0), (this.zero = 0);
}
ky.prototype = {
  checkOffset: function (t) {
    this.checkIndex(this.index + t);
  },
  checkIndex: function (t) {
    if (this.length < this.zero + t || t < 0)
      throw new Error(
        'End of data reached (data length = ' + this.length + ', asked index = ' + t + '). Corrupted zip ?'
      );
  },
  setIndex: function (t) {
    this.checkIndex(t), (this.index = t);
  },
  skip: function (t) {
    this.setIndex(this.index + t);
  },
  byteAt: function () {},
  readInt: function (t) {
    var e,
      n = 0;
    for (this.checkOffset(t), e = this.index + t - 1; e >= this.index; e--) n = (n << 8) + this.byteAt(e);
    return (this.index += t), n;
  },
  readString: function (t) {
    return $_.transformTo('string', this.readData(t));
  },
  readData: function () {},
  lastIndexOfSignature: function () {},
  readAndCheckSignature: function () {},
  readDate: function () {
    var t = this.readInt(4);
    return new Date(
      Date.UTC(
        1980 + ((t >> 25) & 127),
        ((t >> 21) & 15) - 1,
        (t >> 16) & 31,
        (t >> 11) & 31,
        (t >> 5) & 63,
        (31 & t) << 1
      )
    );
  },
};
var Ey = ky,
  Ay = Ey;
function qt(r) {
  Ay.call(this, r);
  for (var t = 0; t < this.data.length; t++) r[t] = 255 & r[t];
}
We().inherits(qt, Ay),
  (qt.prototype.byteAt = function (r) {
    return this.data[this.zero + r];
  }),
  (qt.prototype.lastIndexOfSignature = function (r) {
    for (
      var t = r.charCodeAt(0), e = r.charCodeAt(1), n = r.charCodeAt(2), a = r.charCodeAt(3), i = this.length - 4;
      i >= 0;
      --i
    )
      if (this.data[i] === t && this.data[i + 1] === e && this.data[i + 2] === n && this.data[i + 3] === a)
        return i - this.zero;
    return -1;
  }),
  (qt.prototype.readAndCheckSignature = function (r) {
    var t = r.charCodeAt(0),
      e = r.charCodeAt(1),
      n = r.charCodeAt(2),
      a = r.charCodeAt(3),
      i = this.readData(4);
    return t === i[0] && e === i[1] && n === i[2] && a === i[3];
  }),
  (qt.prototype.readData = function (r) {
    if ((this.checkOffset(r), r === 0)) return [];
    var t = this.data.slice(this.zero + this.index, this.zero + this.index + r);
    return (this.index += r), t;
  });
var Ry = qt,
  Ty = Ey;
function Bt(r) {
  Ty.call(this, r);
}
We().inherits(Bt, Ty),
  (Bt.prototype.byteAt = function (r) {
    return this.data.charCodeAt(this.zero + r);
  }),
  (Bt.prototype.lastIndexOfSignature = function (r) {
    return this.data.lastIndexOf(r) - this.zero;
  }),
  (Bt.prototype.readAndCheckSignature = function (r) {
    return r === this.readData(4);
  }),
  (Bt.prototype.readData = function (r) {
    this.checkOffset(r);
    var t = this.data.slice(this.zero + this.index, this.zero + this.index + r);
    return (this.index += r), t;
  });
var K_ = Bt,
  xy = Ry;
function Bs(r) {
  xy.call(this, r);
}
We().inherits(Bs, xy),
  (Bs.prototype.readData = function (r) {
    if ((this.checkOffset(r), r === 0)) return new Uint8Array(0);
    var t = this.data.subarray(this.zero + this.index, this.zero + this.index + r);
    return (this.index += r), t;
  });
var Py = Bs,
  Iy = Py;
function Ds(r) {
  Iy.call(this, r);
}
We().inherits(Ds, Iy),
  (Ds.prototype.readData = function (r) {
    this.checkOffset(r);
    var t = this.data.slice(this.zero + this.index, this.zero + this.index + r);
    return (this.index += r), t;
  });
var Z_ = Ds,
  jn = We(),
  xv = Xe,
  X_ = Ry,
  Y_ = K_,
  J_ = Z_,
  Q_ = Py,
  Cy = function (t) {
    var e = jn.getTypeOf(t);
    return (
      jn.checkSupport(e),
      e !== 'string' || xv.uint8array
        ? e === 'nodebuffer'
          ? new J_(t)
          : xv.uint8array
          ? new Q_(jn.transformTo('uint8array', t))
          : new X_(jn.transformTo('array', t))
        : new Y_(t)
    );
  },
  ws = Cy,
  at = We(),
  e0 = cu,
  Pv = lu,
  Ln = Kt,
  Un = Qn,
  r0 = Xe;
function Oy(r, t) {
  (this.options = r), (this.loadOptions = t);
}
Oy.prototype = {
  isEncrypted: function () {
    return !(1 & ~this.bitFlag);
  },
  useUTF8: function () {
    return !(2048 & ~this.bitFlag);
  },
  readLocalPart: function (t) {
    var e, n;
    if (
      (t.skip(22),
      (this.fileNameLength = t.readInt(2)),
      (n = t.readInt(2)),
      (this.fileName = t.readData(this.fileNameLength)),
      t.skip(n),
      this.compressedSize === -1 || this.uncompressedSize === -1)
    )
      throw new Error(
        "Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)"
      );
    if (
      (e = (function (a) {
        for (var i in Un) if (Object.prototype.hasOwnProperty.call(Un, i) && Un[i].magic === a) return Un[i];
        return null;
      })(this.compressionMethod)) === null
    )
      throw new Error(
        'Corrupted zip : compression ' +
          at.pretty(this.compressionMethod) +
          ' unknown (inner file : ' +
          at.transformTo('string', this.fileName) +
          ')'
      );
    this.decompressed = new e0(
      this.compressedSize,
      this.uncompressedSize,
      this.crc32,
      e,
      t.readData(this.compressedSize)
    );
  },
  readCentralPart: function (t) {
    (this.versionMadeBy = t.readInt(2)),
      t.skip(2),
      (this.bitFlag = t.readInt(2)),
      (this.compressionMethod = t.readString(2)),
      (this.date = t.readDate()),
      (this.crc32 = t.readInt(4)),
      (this.compressedSize = t.readInt(4)),
      (this.uncompressedSize = t.readInt(4));
    var e = t.readInt(2);
    if (
      ((this.extraFieldsLength = t.readInt(2)),
      (this.fileCommentLength = t.readInt(2)),
      (this.diskNumberStart = t.readInt(2)),
      (this.internalFileAttributes = t.readInt(2)),
      (this.externalFileAttributes = t.readInt(4)),
      (this.localHeaderOffset = t.readInt(4)),
      this.isEncrypted())
    )
      throw new Error('Encrypted zip are not supported');
    t.skip(e),
      this.readExtraFields(t),
      this.parseZIP64ExtraField(t),
      (this.fileComment = t.readData(this.fileCommentLength));
  },
  processAttributes: function () {
    (this.unixPermissions = null), (this.dosPermissions = null);
    var t = this.versionMadeBy >> 8;
    (this.dir = !!(16 & this.externalFileAttributes)),
      t === 0 && (this.dosPermissions = 63 & this.externalFileAttributes),
      t === 3 && (this.unixPermissions = (this.externalFileAttributes >> 16) & 65535),
      this.dir || this.fileNameStr.slice(-1) !== '/' || (this.dir = !0);
  },
  parseZIP64ExtraField: function () {
    if (this.extraFields[1]) {
      var t = ws(this.extraFields[1].value);
      this.uncompressedSize === at.MAX_VALUE_32BITS && (this.uncompressedSize = t.readInt(8)),
        this.compressedSize === at.MAX_VALUE_32BITS && (this.compressedSize = t.readInt(8)),
        this.localHeaderOffset === at.MAX_VALUE_32BITS && (this.localHeaderOffset = t.readInt(8)),
        this.diskNumberStart === at.MAX_VALUE_32BITS && (this.diskNumberStart = t.readInt(4));
    }
  },
  readExtraFields: function (t) {
    var e,
      n,
      a,
      i = t.index + this.extraFieldsLength;
    for (this.extraFields || (this.extraFields = {}); t.index + 4 < i; )
      (e = t.readInt(2)),
        (n = t.readInt(2)),
        (a = t.readData(n)),
        (this.extraFields[e] = { id: e, length: n, value: a });
    t.setIndex(i);
  },
  handleUTF8: function () {
    var t = r0.uint8array ? 'uint8array' : 'array';
    if (this.useUTF8())
      (this.fileNameStr = Ln.utf8decode(this.fileName)), (this.fileCommentStr = Ln.utf8decode(this.fileComment));
    else {
      var e = this.findExtraFieldUnicodePath();
      if (e !== null) this.fileNameStr = e;
      else {
        var n = at.transformTo(t, this.fileName);
        this.fileNameStr = this.loadOptions.decodeFileName(n);
      }
      var a = this.findExtraFieldUnicodeComment();
      if (a !== null) this.fileCommentStr = a;
      else {
        var i = at.transformTo(t, this.fileComment);
        this.fileCommentStr = this.loadOptions.decodeFileName(i);
      }
    }
  },
  findExtraFieldUnicodePath: function () {
    var t = this.extraFields[28789];
    if (t) {
      var e = ws(t.value);
      return e.readInt(1) !== 1 || Pv(this.fileName) !== e.readInt(4) ? null : Ln.utf8decode(e.readData(t.length - 5));
    }
    return null;
  },
  findExtraFieldUnicodeComment: function () {
    var t = this.extraFields[25461];
    if (t) {
      var e = ws(t.value);
      return e.readInt(1) !== 1 || Pv(this.fileComment) !== e.readInt(4)
        ? null
        : Ln.utf8decode(e.readData(t.length - 5));
    }
    return null;
  },
};
var t0 = Oy,
  n0 = Cy,
  Zr = We(),
  Mr = yy,
  a0 = t0,
  i0 = Xe;
function Ny(r) {
  (this.files = []), (this.loadOptions = r);
}
Ny.prototype = {
  checkSignature: function (t) {
    if (!this.reader.readAndCheckSignature(t)) {
      this.reader.index -= 4;
      var e = this.reader.readString(4);
      throw new Error(
        'Corrupted zip or bug: unexpected signature (' + Zr.pretty(e) + ', expected ' + Zr.pretty(t) + ')'
      );
    }
  },
  isSignature: function (t, e) {
    var n = this.reader.index;
    this.reader.setIndex(t);
    var a = this.reader.readString(4) === e;
    return this.reader.setIndex(n), a;
  },
  readBlockEndOfCentral: function () {
    (this.diskNumber = this.reader.readInt(2)),
      (this.diskWithCentralDirStart = this.reader.readInt(2)),
      (this.centralDirRecordsOnThisDisk = this.reader.readInt(2)),
      (this.centralDirRecords = this.reader.readInt(2)),
      (this.centralDirSize = this.reader.readInt(4)),
      (this.centralDirOffset = this.reader.readInt(4)),
      (this.zipCommentLength = this.reader.readInt(2));
    var t = this.reader.readData(this.zipCommentLength),
      e = i0.uint8array ? 'uint8array' : 'array',
      n = Zr.transformTo(e, t);
    this.zipComment = this.loadOptions.decodeFileName(n);
  },
  readBlockZip64EndOfCentral: function () {
    (this.zip64EndOfCentralSize = this.reader.readInt(8)),
      this.reader.skip(4),
      (this.diskNumber = this.reader.readInt(4)),
      (this.diskWithCentralDirStart = this.reader.readInt(4)),
      (this.centralDirRecordsOnThisDisk = this.reader.readInt(8)),
      (this.centralDirRecords = this.reader.readInt(8)),
      (this.centralDirSize = this.reader.readInt(8)),
      (this.centralDirOffset = this.reader.readInt(8)),
      (this.zip64ExtensibleData = {});
    for (var t, e, n, a = this.zip64EndOfCentralSize - 44; 0 < a; )
      (t = this.reader.readInt(2)),
        (e = this.reader.readInt(4)),
        (n = this.reader.readData(e)),
        (this.zip64ExtensibleData[t] = { id: t, length: e, value: n });
  },
  readBlockZip64EndOfCentralLocator: function () {
    if (
      ((this.diskWithZip64CentralDirStart = this.reader.readInt(4)),
      (this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8)),
      (this.disksCount = this.reader.readInt(4)),
      this.disksCount > 1)
    )
      throw new Error('Multi-volumes zip are not supported');
  },
  readLocalFiles: function () {
    var t, e;
    for (t = 0; t < this.files.length; t++)
      (e = this.files[t]),
        this.reader.setIndex(e.localHeaderOffset),
        this.checkSignature(Mr.LOCAL_FILE_HEADER),
        e.readLocalPart(this.reader),
        e.handleUTF8(),
        e.processAttributes();
  },
  readCentralDir: function () {
    var t;
    for (this.reader.setIndex(this.centralDirOffset); this.reader.readAndCheckSignature(Mr.CENTRAL_FILE_HEADER); )
      (t = new a0({ zip64: this.zip64 }, this.loadOptions)).readCentralPart(this.reader), this.files.push(t);
    if (this.centralDirRecords !== this.files.length && this.centralDirRecords !== 0 && this.files.length === 0)
      throw new Error(
        'Corrupted zip or bug: expected ' + this.centralDirRecords + ' records in central dir, got ' + this.files.length
      );
  },
  readEndOfCentral: function () {
    var t = this.reader.lastIndexOfSignature(Mr.CENTRAL_DIRECTORY_END);
    if (t < 0)
      throw this.isSignature(0, Mr.LOCAL_FILE_HEADER)
        ? new Error("Corrupted zip: can't find end of central directory")
        : new Error(
            "Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html"
          );
    this.reader.setIndex(t);
    var e = t;
    if (
      (this.checkSignature(Mr.CENTRAL_DIRECTORY_END),
      this.readBlockEndOfCentral(),
      this.diskNumber === Zr.MAX_VALUE_16BITS ||
        this.diskWithCentralDirStart === Zr.MAX_VALUE_16BITS ||
        this.centralDirRecordsOnThisDisk === Zr.MAX_VALUE_16BITS ||
        this.centralDirRecords === Zr.MAX_VALUE_16BITS ||
        this.centralDirSize === Zr.MAX_VALUE_32BITS ||
        this.centralDirOffset === Zr.MAX_VALUE_32BITS)
    ) {
      if (((this.zip64 = !0), (t = this.reader.lastIndexOfSignature(Mr.ZIP64_CENTRAL_DIRECTORY_LOCATOR)) < 0))
        throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");
      if (
        (this.reader.setIndex(t),
        this.checkSignature(Mr.ZIP64_CENTRAL_DIRECTORY_LOCATOR),
        this.readBlockZip64EndOfCentralLocator(),
        !this.isSignature(this.relativeOffsetEndOfZip64CentralDir, Mr.ZIP64_CENTRAL_DIRECTORY_END) &&
          ((this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(Mr.ZIP64_CENTRAL_DIRECTORY_END)),
          this.relativeOffsetEndOfZip64CentralDir < 0))
      )
        throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");
      this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir),
        this.checkSignature(Mr.ZIP64_CENTRAL_DIRECTORY_END),
        this.readBlockZip64EndOfCentral();
    }
    var n = this.centralDirOffset + this.centralDirSize;
    this.zip64 && ((n += 20), (n += 12 + this.zip64EndOfCentralSize));
    var a = e - n;
    if (a > 0) this.isSignature(e, Mr.CENTRAL_FILE_HEADER) || (this.reader.zero = a);
    else if (a < 0) throw new Error('Corrupted zip: missing ' + Math.abs(a) + ' bytes.');
  },
  prepareReader: function (t) {
    this.reader = n0(t);
  },
  load: function (t) {
    this.prepareReader(t), this.readEndOfCentral(), this.readCentralDir(), this.readLocalFiles();
  },
};
var o0 = Ny,
  Ss = We(),
  Xn = In,
  s0 = Kt,
  u0 = o0,
  l0 = Km,
  Iv = va;
function c0(r) {
  return new Xn.Promise(function (t, e) {
    var n = r.decompressed.getContentWorker().pipe(new l0());
    n.on('error', function (a) {
      e(a);
    })
      .on('end', function () {
        n.streamInfo.crc32 !== r.decompressed.crc32 ? e(new Error('Corrupted zip : CRC32 mismatch')) : t();
      })
      .resume();
  });
}
function Ir() {
  if (!(this instanceof Ir)) return new Ir();
  if (arguments.length)
    throw new Error('The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.');
  (this.files = Object.create(null)),
    (this.comment = null),
    (this.root = ''),
    (this.clone = function () {
      var r = new Ir();
      for (var t in this) typeof this[t] != 'function' && (r[t] = this[t]);
      return r;
    });
}
(Ir.prototype = V_),
  (Ir.prototype.loadAsync = function (r, t) {
    var e = this;
    return (
      (t = Ss.extend(t || {}, {
        base64: !1,
        checkCRC32: !1,
        optimizedBinaryString: !1,
        createFolders: !1,
        decodeFileName: s0.utf8decode,
      })),
      Iv.isNode && Iv.isStream(r)
        ? Xn.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file."))
        : Ss.prepareContent('the loaded zip file', r, !0, t.optimizedBinaryString, t.base64)
            .then(function (n) {
              var a = new u0(t);
              return a.load(n), a;
            })
            .then(function (n) {
              var a = [Xn.Promise.resolve(n)],
                i = n.files;
              if (t.checkCRC32) for (var o = 0; o < i.length; o++) a.push(c0(i[o]));
              return Xn.Promise.all(a);
            })
            .then(function (n) {
              for (var a = n.shift(), i = a.files, o = 0; o < i.length; o++) {
                var s = i[o],
                  u = s.fileNameStr,
                  l = Ss.resolve(s.fileNameStr);
                e.file(l, s.decompressed, {
                  binary: !0,
                  optimizedBinaryString: !0,
                  date: s.date,
                  dir: s.dir,
                  comment: s.fileCommentStr.length ? s.fileCommentStr : null,
                  unixPermissions: s.unixPermissions,
                  dosPermissions: s.dosPermissions,
                  createFolders: t.createFolders,
                }),
                  s.dir || (e.file(l).unsafeOriginalName = u);
              }
              return a.zipComment.length && (e.comment = a.zipComment), e;
            })
    );
  }),
  (Ir.support = Xe),
  (Ir.defaults = Gm),
  (Ir.version = '3.10.1'),
  (Ir.loadAsync = function (r, t) {
    return new Ir().loadAsync(r, t);
  }),
  (Ir.external = In);
var $e,
  f0 = e_(Ir);
(function (r) {
  (r.OfficeDocument = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'),
    (r.FontTable = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable'),
    (r.Image = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'),
    (r.Numbering = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering'),
    (r.Styles = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles'),
    (r.StylesWithEffects = 'http://schemas.microsoft.com/office/2007/relationships/stylesWithEffects'),
    (r.Theme = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme'),
    (r.Settings = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings'),
    (r.WebSettings = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings'),
    (r.Hyperlink = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'),
    (r.Footnotes = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes'),
    (r.Endnotes = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes'),
    (r.Footer = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer'),
    (r.Header = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'),
    (r.ExtendedProperties = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties'),
    (r.CoreProperties = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'),
    (r.CustomProperties = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/custom-properties'),
    (r.Comments = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'),
    (r.CommentsExtended = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended');
})($e || ($e = {}));
var My = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  ma = { mul: 0.05, unit: 'pt' },
  Wr = { mul: 1 / 12700, unit: 'pt' },
  js = { mul: 0.5, unit: 'pt' },
  Fy = { mul: 0.125, unit: 'pt' },
  h0 = { mul: 1, unit: 'pt' },
  d0 = { mul: 0.02, unit: '%' };
function qy(r) {
  var t = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : ma;
  return r == null || /.+(p[xt]|[%])$/.test(r) ? r : ''.concat((parseInt(r) * t.mul).toFixed(2)).concat(t.unit);
}
function By(r, t, e) {
  if (r.namespaceURI != My) return !1;
  switch (r.localName) {
    case 'color':
      t.color = e.attr(r, 'val');
      break;
    case 'sz':
      t.fontSize = e.lengthAttr(r, 'val', js);
      break;
    default:
      return !1;
  }
  return !0;
}
var Dy = (function () {
    function r() {
      be(this, r);
    }
    return _e(r, [
      {
        key: 'elements',
        value: function (e) {
          for (
            var n = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null,
              a = [],
              i = 0,
              o = e.childNodes.length;
            i < o;
            i++
          ) {
            var s = e.childNodes.item(i);
            s.nodeType != 1 || (n != null && s.localName != n) || a.push(s);
          }
          return a;
        },
      },
      {
        key: 'element',
        value: function (e, n) {
          for (var a = 0, i = e.childNodes.length; a < i; a++) {
            var o = e.childNodes.item(a);
            if (o.nodeType == 1 && o.localName == n) return o;
          }
          return null;
        },
      },
      {
        key: 'elementAttr',
        value: function (e, n, a) {
          var i = this.element(e, n);
          return i ? this.attr(i, a) : void 0;
        },
      },
      {
        key: 'attrs',
        value: function (e) {
          return Array.from(e.attributes);
        },
      },
      {
        key: 'attr',
        value: function (e, n) {
          for (var a = 0, i = e.attributes.length; a < i; a++) {
            var o = e.attributes.item(a);
            if (o.localName == n) return o.value;
          }
          return null;
        },
      },
      {
        key: 'intAttr',
        value: function (e, n) {
          var a = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : null,
            i = this.attr(e, n);
          return i ? parseInt(i) : a;
        },
      },
      {
        key: 'hexAttr',
        value: function (e, n) {
          var a = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : null,
            i = this.attr(e, n);
          return i ? parseInt(i, 16) : a;
        },
      },
      {
        key: 'floatAttr',
        value: function (e, n) {
          var a = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : null,
            i = this.attr(e, n);
          return i ? parseFloat(i) : a;
        },
      },
      {
        key: 'boolAttr',
        value: function (e, n) {
          var a = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : null;
          return (function (i) {
            var o = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !1;
            switch (i) {
              case '1':
              case 'on':
              case 'true':
                return !0;
              case '0':
              case 'off':
              case 'false':
                return !1;
              default:
                return o;
            }
          })(this.attr(e, n), a);
        },
      },
      {
        key: 'lengthAttr',
        value: function (e, n) {
          var a = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : ma;
          return qy(this.attr(e, n), a);
        },
      },
    ]);
  })(),
  O = new Dy(),
  Ar = (function () {
    function r(t, e) {
      be(this, r), (this._package = t), (this.path = e);
    }
    return _e(r, [
      {
        key: 'load',
        value: (function () {
          var t = Sr(
            Ie().mark(function n() {
              var a, i;
              return Ie().wrap(
                function (s) {
                  for (;;)
                    switch ((s.prev = s.next)) {
                      case 0:
                        return (s.next = 2), this._package.loadRelationships(this.path);
                      case 2:
                        return (this.rels = s.sent), (s.next = 5), this._package.load(this.path);
                      case 5:
                        (a = s.sent),
                          (i = this._package.parseXmlDocument(a)),
                          this._package.options.keepOrigin && (this._xmlDocument = i),
                          this.parseXml(i.firstElementChild);
                      case 8:
                      case 'end':
                        return s.stop();
                    }
                },
                n,
                this
              );
            })
          );
          function e() {
            return t.apply(this, arguments);
          }
          return e;
        })(),
      },
      {
        key: 'save',
        value: function () {
          var e;
          this._package.update(this.path, ((e = this._xmlDocument), new XMLSerializer().serializeToString(e)));
        },
      },
      { key: 'parseXml', value: function (e) {} },
    ]);
  })(),
  p0 = { embedRegular: 'regular', embedBold: 'bold', embedItalic: 'italic', embedBoldItalic: 'boldItalic' };
function v0(r, t) {
  return t.elements(r).map(function (e) {
    return (function (n, a) {
      var i = { name: a.attr(n, 'name'), embedFontRefs: [] },
        o = pe(a.elements(n)),
        s;
      try {
        for (o.s(); !(s = o.n()).done; ) {
          var u = s.value;
          switch (u.localName) {
            case 'family':
              i.family = a.attr(u, 'val');
              break;
            case 'altName':
              i.altName = a.attr(u, 'val');
              break;
            case 'embedRegular':
            case 'embedBold':
            case 'embedItalic':
            case 'embedBoldItalic':
              i.embedFontRefs.push(m0(u, a));
          }
        }
      } catch (l) {
        o.e(l);
      } finally {
        o.f();
      }
      return i;
    })(e, t);
  });
}
function m0(r, t) {
  return { id: t.attr(r, 'id'), key: t.attr(r, 'fontKey'), type: p0[r.localName] };
}
var y0 = (function (r) {
  function t() {
    return be(this, t), Ne(this, t, arguments);
  }
  return (
    Me(t, r),
    _e(t, [
      {
        key: 'parseXml',
        value: function (n) {
          this.fonts = v0(n, this._package.xmlParser);
        },
      },
    ])
  );
})(Ar);
function Yn(r) {
  var t = r.lastIndexOf('/') + 1;
  return [t == 0 ? '' : r.substring(0, t), t == 0 ? r : r.substring(t)];
}
function ks(r, t) {
  try {
    var e = 'http://docx/';
    return new URL(r, e + t).toString().substring(e.length);
  } catch {
    return ''.concat(t).concat(r);
  }
}
function ut(r, t) {
  return r.reduce(function (e, n) {
    return (e[t(n)] = n), e;
  }, {});
}
function Es(r) {
  return r && yr(r) == 'object' && !Array.isArray(r);
}
function na(r) {
  for (var t = arguments.length, e = new Array(t > 1 ? t - 1 : 0), n = 1; n < t; n++) e[n - 1] = arguments[n];
  if (!e.length) return r;
  var a = e.shift();
  if (Es(r) && Es(a))
    for (var i in a)
      if (Es(a[i])) {
        var o;
        na((o = r[i]) !== null && o !== void 0 ? o : (r[i] = {}), a[i]);
      } else r[i] = a[i];
  return na.apply(void 0, [r].concat(e));
}
function Jt(r) {
  return Array.isArray(r) ? r : [r];
}
var g0 = (function () {
    function r(t, e) {
      be(this, r), (this._zip = t), (this.options = e), (this.xmlParser = new Dy());
    }
    return _e(
      r,
      [
        {
          key: 'get',
          value: function (e) {
            var n,
              a = (function (i) {
                return i.startsWith('/') ? i.substr(1) : i;
              })(e);
            return (n = this._zip.files[a]) !== null && n !== void 0 ? n : this._zip.files[a.replace(/\//g, '\\')];
          },
        },
        {
          key: 'update',
          value: function (e, n) {
            this._zip.file(e, n);
          },
        },
        {
          key: 'save',
          value: function () {
            var e = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 'blob';
            return this._zip.generateAsync({ type: e });
          },
        },
        {
          key: 'load',
          value: function (e) {
            var n,
              a,
              i = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 'string';
            return (n = (a = this.get(e)) === null || a === void 0 ? void 0 : a.async(i)) !== null && n !== void 0
              ? n
              : Promise.resolve(null);
          },
        },
        {
          key: 'loadRelationships',
          value: (function () {
            var t = Sr(
              Ie().mark(function n() {
                var a,
                  i,
                  o,
                  s,
                  u,
                  l,
                  c,
                  h,
                  d,
                  f = arguments;
                return Ie().wrap(
                  function (v) {
                    for (;;)
                      switch ((v.prev = v.next)) {
                        case 0:
                          return (
                            (a = f.length > 0 && f[0] !== void 0 ? f[0] : null),
                            (i = '_rels/.rels'),
                            a != null &&
                              ((o = Yn(a)),
                              (s = ct(o, 2)),
                              (u = s[0]),
                              (l = s[1]),
                              (i = ''.concat(u, '_rels/').concat(l, '.rels'))),
                            (v.next = 5),
                            this.load(i)
                          );
                        case 5:
                          return (
                            (c = v.sent),
                            v.abrupt(
                              'return',
                              c
                                ? ((h = this.parseXmlDocument(c).firstElementChild),
                                  (d = this.xmlParser).elements(h).map(function (y) {
                                    return {
                                      id: d.attr(y, 'Id'),
                                      type: d.attr(y, 'Type'),
                                      target: d.attr(y, 'Target'),
                                      targetMode: d.attr(y, 'TargetMode'),
                                    };
                                  }))
                                : null
                            )
                          );
                        case 7:
                        case 'end':
                          return v.stop();
                      }
                  },
                  n,
                  this
                );
              })
            );
            function e() {
              return t.apply(this, arguments);
            }
            return e;
          })(),
        },
        {
          key: 'parseXmlDocument',
          value: function (e) {
            return (function (n) {
              var a,
                i = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !1,
                o;
              i && (n = n.replace(/<[?].*[?]>/, '')), (n = (o = n).charCodeAt(0) === 65279 ? o.substring(1) : o);
              var s = new DOMParser().parseFromString(n, 'application/xml'),
                u =
                  ((l = s),
                  (a = l.getElementsByTagName('parsererror')[0]) === null || a === void 0 ? void 0 : a.textContent),
                l;
              if (u) throw new Error(u);
              return s;
            })(e, this.options.trimXmlDeclaration);
          },
        },
      ],
      [
        {
          key: 'load',
          value: (function () {
            var t = Sr(
              Ie().mark(function n(a, i) {
                var o;
                return Ie().wrap(function (u) {
                  for (;;)
                    switch ((u.prev = u.next)) {
                      case 0:
                        return (u.next = 2), f0.loadAsync(a);
                      case 2:
                        return (o = u.sent), u.abrupt('return', new r(o, i));
                      case 4:
                      case 'end':
                        return u.stop();
                    }
                }, n);
              })
            );
            function e(n, a) {
              return t.apply(this, arguments);
            }
            return e;
          })(),
        },
      ]
    );
  })(),
  b0 = (function (r) {
    function t(e, n, a) {
      var i;
      return be(this, t), (i = Ne(this, t, [e, n])), (i._documentParser = a), i;
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            this.body = this._documentParser.parseDocumentFile(n);
          },
        },
      ])
    );
  })(Ar);
function zn(r, t) {
  return {
    type: t.attr(r, 'val'),
    color: t.attr(r, 'color'),
    size: t.lengthAttr(r, 'sz', Fy),
    offset: t.lengthAttr(r, 'space', h0),
    frame: t.boolAttr(r, 'frame'),
    shadow: t.boolAttr(r, 'shadow'),
  };
}
function _0(r, t) {
  var e = {},
    n = pe(t.elements(r)),
    a;
  try {
    for (n.s(); !(a = n.n()).done; ) {
      var i = a.value;
      switch (i.localName) {
        case 'left':
          e.left = zn(i, t);
          break;
        case 'top':
          e.top = zn(i, t);
          break;
        case 'right':
          e.right = zn(i, t);
          break;
        case 'bottom':
          e.bottom = zn(i, t);
      }
    }
  } catch (o) {
    n.e(o);
  } finally {
    n.f();
  }
  return e;
}
var Cv, F;
function jy(r) {
  var t,
    e,
    n = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : O,
    a = {},
    i = pe(n.elements(r)),
    o;
  try {
    for (i.s(); !(o = i.n()).done; ) {
      var s = o.value;
      switch (s.localName) {
        case 'pgSz':
          a.pageSize = { width: n.lengthAttr(s, 'w'), height: n.lengthAttr(s, 'h'), orientation: n.attr(s, 'orient') };
          break;
        case 'type':
          a.type = n.attr(s, 'val');
          break;
        case 'pgMar':
          a.pageMargins = {
            left: n.lengthAttr(s, 'left'),
            right: n.lengthAttr(s, 'right'),
            top: n.lengthAttr(s, 'top'),
            bottom: n.lengthAttr(s, 'bottom'),
            header: n.lengthAttr(s, 'header'),
            footer: n.lengthAttr(s, 'footer'),
            gutter: n.lengthAttr(s, 'gutter'),
          };
          break;
        case 'cols':
          a.columns = w0(s, n);
          break;
        case 'headerReference':
          ((t = a.headerRefs) !== null && t !== void 0 ? t : (a.headerRefs = [])).push(Ov(s, n));
          break;
        case 'footerReference':
          ((e = a.footerRefs) !== null && e !== void 0 ? e : (a.footerRefs = [])).push(Ov(s, n));
          break;
        case 'titlePg':
          a.titlePage = n.boolAttr(s, 'val', !0);
          break;
        case 'pgBorders':
          a.pageBorders = _0(s, n);
          break;
        case 'pgNumType':
          a.pageNumber = S0(s, n);
      }
    }
  } catch (u) {
    i.e(u);
  } finally {
    i.f();
  }
  return a;
}
function w0(r, t) {
  return {
    numberOfColumns: t.intAttr(r, 'num'),
    space: t.lengthAttr(r, 'space'),
    separator: t.boolAttr(r, 'sep'),
    equalWidth: t.boolAttr(r, 'equalWidth', !0),
    columns: t.elements(r, 'col').map(function (e) {
      return { width: t.lengthAttr(e, 'w'), space: t.lengthAttr(e, 'space') };
    }),
  };
}
function S0(r, t) {
  return {
    chapSep: t.attr(r, 'chapSep'),
    chapStyle: t.attr(r, 'chapStyle'),
    format: t.attr(r, 'fmt'),
    start: t.intAttr(r, 'start'),
  };
}
function Ov(r, t) {
  return { id: t.attr(r, 'id'), type: t.attr(r, 'type') };
}
function pu(r, t) {
  var e = {},
    n = pe(t.elements(r)),
    a;
  try {
    for (n.s(); !(a = n.n()).done; ) {
      var i = a.value;
      k0(i, e, t);
    }
  } catch (o) {
    n.e(o);
  } finally {
    n.f();
  }
  return e;
}
function k0(r, t, e) {
  return !!By(r, t, e);
}
function Ly(r, t) {
  var e = {},
    n = pe(t.elements(r)),
    a;
  try {
    for (n.s(); !(a = n.n()).done; ) {
      var i = a.value;
      Uy(i, e, t);
    }
  } catch (o) {
    n.e(o);
  } finally {
    n.f();
  }
  return e;
}
function Uy(r, t, e) {
  if (r.namespaceURI != My) return !1;
  if (By(r, t, e)) return !0;
  switch (r.localName) {
    case 'tabs':
      t.tabs = (function (n, a) {
        return a.elements(n, 'tab').map(function (i) {
          return { position: a.lengthAttr(i, 'pos'), leader: a.attr(i, 'leader'), style: a.attr(i, 'val') };
        });
      })(r, e);
      break;
    case 'sectPr':
      t.sectionProps = jy(r, e);
      break;
    case 'numPr':
      t.numbering = (function (n, a) {
        var i = {},
          o = pe(a.elements(n)),
          s;
        try {
          for (o.s(); !(s = o.n()).done; ) {
            var u = s.value;
            switch (u.localName) {
              case 'numId':
                i.id = a.attr(u, 'val');
                break;
              case 'ilvl':
                i.level = a.intAttr(u, 'val');
            }
          }
        } catch (l) {
          o.e(l);
        } finally {
          o.f();
        }
        return i;
      })(r, e);
      break;
    case 'spacing':
      return (
        (t.lineSpacing = (function (n, a) {
          return {
            before: a.lengthAttr(n, 'before'),
            after: a.lengthAttr(n, 'after'),
            line: a.intAttr(n, 'line'),
            lineRule: a.attr(n, 'lineRule'),
          };
        })(r, e)),
        !1
      );
    case 'textAlignment':
      return (t.textAlignment = e.attr(r, 'val')), !1;
    case 'keepLines':
      t.keepLines = e.boolAttr(r, 'val', !0);
      break;
    case 'keepNext':
      t.keepNext = e.boolAttr(r, 'val', !0);
      break;
    case 'pageBreakBefore':
      t.pageBreakBefore = e.boolAttr(r, 'val', !0);
      break;
    case 'outlineLvl':
      t.outlineLevel = e.intAttr(r, 'val');
      break;
    case 'pStyle':
      t.styleName = e.attr(r, 'val');
      break;
    case 'rPr':
      t.runProps = pu(r, e);
      break;
    default:
      return !1;
  }
  return !0;
}
function E0(r, t) {
  var e = { id: t.attr(r, 'numId'), overrides: [] },
    n = pe(t.elements(r)),
    a;
  try {
    for (n.s(); !(a = n.n()).done; ) {
      var i = a.value;
      switch (i.localName) {
        case 'abstractNumId':
          e.abstractId = t.attr(i, 'val');
          break;
        case 'lvlOverride':
          e.overrides.push(R0(i, t));
      }
    }
  } catch (o) {
    n.e(o);
  } finally {
    n.f();
  }
  return e;
}
function A0(r, t) {
  var e = { id: t.attr(r, 'abstractNumId'), levels: [] },
    n = pe(t.elements(r)),
    a;
  try {
    for (n.s(); !(a = n.n()).done; ) {
      var i = a.value;
      switch (i.localName) {
        case 'name':
          e.name = t.attr(i, 'val');
          break;
        case 'multiLevelType':
          e.multiLevelType = t.attr(i, 'val');
          break;
        case 'numStyleLink':
          e.numberingStyleLink = t.attr(i, 'val');
          break;
        case 'styleLink':
          e.styleLink = t.attr(i, 'val');
          break;
        case 'lvl':
          e.levels.push(zy(i, t));
      }
    }
  } catch (o) {
    n.e(o);
  } finally {
    n.f();
  }
  return e;
}
function zy(r, t) {
  var e = { level: t.intAttr(r, 'ilvl') },
    n = pe(t.elements(r)),
    a;
  try {
    for (n.s(); !(a = n.n()).done; ) {
      var i = a.value;
      switch (i.localName) {
        case 'start':
          e.start = t.attr(i, 'val');
          break;
        case 'lvlRestart':
          e.restart = t.intAttr(i, 'val');
          break;
        case 'numFmt':
          e.format = t.attr(i, 'val');
          break;
        case 'lvlText':
          e.text = t.attr(i, 'val');
          break;
        case 'lvlJc':
          e.justification = t.attr(i, 'val');
          break;
        case 'lvlPicBulletId':
          e.bulletPictureId = t.attr(i, 'val');
          break;
        case 'pStyle':
          e.paragraphStyle = t.attr(i, 'val');
          break;
        case 'pPr':
          e.paragraphProps = Ly(i, t);
          break;
        case 'rPr':
          e.runProps = pu(i, t);
      }
    }
  } catch (o) {
    n.e(o);
  } finally {
    n.f();
  }
  return e;
}
function R0(r, t) {
  var e = { level: t.intAttr(r, 'ilvl') },
    n = pe(t.elements(r)),
    a;
  try {
    for (n.s(); !(a = n.n()).done; ) {
      var i = a.value;
      switch (i.localName) {
        case 'startOverride':
          e.start = t.intAttr(i, 'val');
          break;
        case 'lvl':
          e.numberingLevel = zy(i, t);
      }
    }
  } catch (o) {
    n.e(o);
  } finally {
    n.f();
  }
  return e;
}
function T0(r, t) {
  var e = t.element(r, 'pict'),
    n = e && t.element(e, 'shape'),
    a = n && t.element(n, 'imagedata');
  return a ? { id: t.attr(r, 'numPicBulletId'), referenceId: t.attr(a, 'id'), style: t.attr(n, 'style') } : null;
}
(function (r) {
  (r.Continuous = 'continuous'),
    (r.NextPage = 'nextPage'),
    (r.NextColumn = 'nextColumn'),
    (r.EvenPage = 'evenPage'),
    (r.OddPage = 'oddPage');
})(Cv || (Cv = {}));
var x0 = (function (r) {
    function t(e, n, a) {
      var i;
      return be(this, t), (i = Ne(this, t, [e, n])), (i._documentParser = a), i;
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            Object.assign(
              this,
              (function (a, i) {
                var o = { numberings: [], abstractNumberings: [], bulletPictures: [] },
                  s = pe(i.elements(a)),
                  u;
                try {
                  for (s.s(); !(u = s.n()).done; ) {
                    var l = u.value;
                    switch (l.localName) {
                      case 'num':
                        o.numberings.push(E0(l, i));
                        break;
                      case 'abstractNum':
                        o.abstractNumberings.push(A0(l, i));
                        break;
                      case 'numPicBullet':
                        o.bulletPictures.push(T0(l, i));
                    }
                  }
                } catch (c) {
                  s.e(c);
                } finally {
                  s.f();
                }
                return o;
              })(n, this._package.xmlParser)
            ),
              (this.domNumberings = this._documentParser.parseNumberingFile(n));
          },
        },
      ])
    );
  })(Ar),
  P0 = (function (r) {
    function t(e, n, a) {
      var i;
      return be(this, t), (i = Ne(this, t, [e, n])), (i._documentParser = a), i;
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            this.styles = this._documentParser.parseStylesFile(n);
          },
        },
      ])
    );
  })(Ar);
(function (r) {
  (r.Document = 'document'),
    (r.Paragraph = 'paragraph'),
    (r.Run = 'run'),
    (r.Break = 'break'),
    (r.NoBreakHyphen = 'noBreakHyphen'),
    (r.Table = 'table'),
    (r.Row = 'row'),
    (r.Cell = 'cell'),
    (r.Hyperlink = 'hyperlink'),
    (r.SmartTag = 'smartTag'),
    (r.Drawing = 'drawing'),
    (r.Image = 'image'),
    (r.Text = 'text'),
    (r.Tab = 'tab'),
    (r.Symbol = 'symbol'),
    (r.BookmarkStart = 'bookmarkStart'),
    (r.BookmarkEnd = 'bookmarkEnd'),
    (r.Footer = 'footer'),
    (r.Header = 'header'),
    (r.FootnoteReference = 'footnoteReference'),
    (r.EndnoteReference = 'endnoteReference'),
    (r.Footnote = 'footnote'),
    (r.Endnote = 'endnote'),
    (r.SimpleField = 'simpleField'),
    (r.ComplexField = 'complexField'),
    (r.Instruction = 'instruction'),
    (r.VmlPicture = 'vmlPicture'),
    (r.MmlMath = 'mmlMath'),
    (r.MmlMathParagraph = 'mmlMathParagraph'),
    (r.MmlFraction = 'mmlFraction'),
    (r.MmlFunction = 'mmlFunction'),
    (r.MmlFunctionName = 'mmlFunctionName'),
    (r.MmlNumerator = 'mmlNumerator'),
    (r.MmlDenominator = 'mmlDenominator'),
    (r.MmlRadical = 'mmlRadical'),
    (r.MmlBase = 'mmlBase'),
    (r.MmlDegree = 'mmlDegree'),
    (r.MmlSuperscript = 'mmlSuperscript'),
    (r.MmlSubscript = 'mmlSubscript'),
    (r.MmlPreSubSuper = 'mmlPreSubSuper'),
    (r.MmlSubArgument = 'mmlSubArgument'),
    (r.MmlSuperArgument = 'mmlSuperArgument'),
    (r.MmlNary = 'mmlNary'),
    (r.MmlDelimiter = 'mmlDelimiter'),
    (r.MmlRun = 'mmlRun'),
    (r.MmlEquationArray = 'mmlEquationArray'),
    (r.MmlLimit = 'mmlLimit'),
    (r.MmlLimitLower = 'mmlLimitLower'),
    (r.MmlMatrix = 'mmlMatrix'),
    (r.MmlMatrixRow = 'mmlMatrixRow'),
    (r.MmlBox = 'mmlBox'),
    (r.MmlBar = 'mmlBar'),
    (r.MmlGroupChar = 'mmlGroupChar'),
    (r.VmlElement = 'vmlElement'),
    (r.Inserted = 'inserted'),
    (r.Deleted = 'deleted'),
    (r.DeletedText = 'deletedText'),
    (r.Comment = 'comment'),
    (r.CommentReference = 'commentReference'),
    (r.CommentRangeStart = 'commentRangeStart'),
    (r.CommentRangeEnd = 'commentRangeEnd');
})(F || (F = {}));
var It = _e(function r() {
    be(this, r), (this.children = []), (this.cssStyle = {});
  }),
  I0 = (function (r) {
    function t() {
      var e;
      return be(this, t), (e = Ne(this, t, arguments)), (e.type = F.Header), e;
    }
    return Me(t, r), _e(t);
  })(It),
  C0 = (function (r) {
    function t() {
      var e;
      return be(this, t), (e = Ne(this, t, arguments)), (e.type = F.Footer), e;
    }
    return Me(t, r), _e(t);
  })(It),
  Wy = (function (r) {
    function t(e, n, a) {
      var i;
      return be(this, t), (i = Ne(this, t, [e, n])), (i._documentParser = a), i;
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            (this.rootElement = this.createRootElement()),
              (this.rootElement.children = this._documentParser.parseBodyElements(n));
          },
        },
      ])
    );
  })(Ar),
  O0 = (function (r) {
    function t() {
      return be(this, t), Ne(this, t, arguments);
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'createRootElement',
          value: function () {
            return new I0();
          },
        },
      ])
    );
  })(Wy),
  N0 = (function (r) {
    function t() {
      return be(this, t), Ne(this, t, arguments);
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'createRootElement',
          value: function () {
            return new C0();
          },
        },
      ])
    );
  })(Wy);
function Qt(r) {
  if (r !== void 0) return parseInt(r);
}
var M0 = (function (r) {
    function t() {
      return be(this, t), Ne(this, t, arguments);
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            this.props = (function (a, i) {
              var o = {},
                s = pe(i.elements(a)),
                u;
              try {
                for (s.s(); !(u = s.n()).done; ) {
                  var l = u.value;
                  switch (l.localName) {
                    case 'Template':
                      o.template = l.textContent;
                      break;
                    case 'Pages':
                      o.pages = Qt(l.textContent);
                      break;
                    case 'Words':
                      o.words = Qt(l.textContent);
                      break;
                    case 'Characters':
                      o.characters = Qt(l.textContent);
                      break;
                    case 'Application':
                      o.application = l.textContent;
                      break;
                    case 'Lines':
                      o.lines = Qt(l.textContent);
                      break;
                    case 'Paragraphs':
                      o.paragraphs = Qt(l.textContent);
                      break;
                    case 'Company':
                      o.company = l.textContent;
                      break;
                    case 'AppVersion':
                      o.appVersion = l.textContent;
                  }
                }
              } catch (c) {
                s.e(c);
              } finally {
                s.f();
              }
              return o;
            })(n, this._package.xmlParser);
          },
        },
      ])
    );
  })(Ar),
  F0 = (function (r) {
    function t() {
      return be(this, t), Ne(this, t, arguments);
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            this.props = (function (a, i) {
              var o = {},
                s = pe(i.elements(a)),
                u;
              try {
                for (s.s(); !(u = s.n()).done; ) {
                  var l = u.value;
                  switch (l.localName) {
                    case 'title':
                      o.title = l.textContent;
                      break;
                    case 'description':
                      o.description = l.textContent;
                      break;
                    case 'subject':
                      o.subject = l.textContent;
                      break;
                    case 'creator':
                      o.creator = l.textContent;
                      break;
                    case 'keywords':
                      o.keywords = l.textContent;
                      break;
                    case 'language':
                      o.language = l.textContent;
                      break;
                    case 'lastModifiedBy':
                      o.lastModifiedBy = l.textContent;
                      break;
                    case 'revision':
                      l.textContent && (o.revision = parseInt(l.textContent));
                  }
                }
              } catch (c) {
                s.e(c);
              } finally {
                s.f();
              }
              return o;
            })(n, this._package.xmlParser);
          },
        },
      ])
    );
  })(Ar),
  q0 = _e(function r() {
    be(this, r);
  });
function B0(r, t) {
  var e = { name: t.attr(r, 'name'), colors: {} },
    n = pe(t.elements(r)),
    a;
  try {
    for (n.s(); !(a = n.n()).done; ) {
      var i = a.value,
        o = t.element(i, 'srgbClr'),
        s = t.element(i, 'sysClr');
      o ? (e.colors[i.localName] = t.attr(o, 'val')) : s && (e.colors[i.localName] = t.attr(s, 'lastClr'));
    }
  } catch (u) {
    n.e(u);
  } finally {
    n.f();
  }
  return e;
}
function D0(r, t) {
  var e = { name: t.attr(r, 'name') },
    n = pe(t.elements(r)),
    a;
  try {
    for (n.s(); !(a = n.n()).done; ) {
      var i = a.value;
      switch (i.localName) {
        case 'majorFont':
          e.majorFont = Nv(i, t);
          break;
        case 'minorFont':
          e.minorFont = Nv(i, t);
      }
    }
  } catch (o) {
    n.e(o);
  } finally {
    n.f();
  }
  return e;
}
function Nv(r, t) {
  return {
    latinTypeface: t.elementAttr(r, 'latin', 'typeface'),
    eaTypeface: t.elementAttr(r, 'ea', 'typeface'),
    csTypeface: t.elementAttr(r, 'cs', 'typeface'),
  };
}
var j0 = (function (r) {
    function t(e, n) {
      return be(this, t), Ne(this, t, [e, n]);
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            this.theme = (function (a, i) {
              var o = new q0(),
                s = i.element(a, 'themeElements'),
                u = pe(i.elements(s)),
                l;
              try {
                for (u.s(); !(l = u.n()).done; ) {
                  var c = l.value;
                  switch (c.localName) {
                    case 'clrScheme':
                      o.colorScheme = B0(c, i);
                      break;
                    case 'fontScheme':
                      o.fontScheme = D0(c, i);
                  }
                }
              } catch (h) {
                u.e(h);
              } finally {
                u.f();
              }
              return o;
            })(n, this._package.xmlParser);
          },
        },
      ])
    );
  })(Ar),
  Hy = _e(function r() {
    be(this, r);
  }),
  L0 = (function (r) {
    function t() {
      var e;
      return be(this, t), (e = Ne(this, t, arguments)), (e.type = F.Footnote), e;
    }
    return Me(t, r), _e(t);
  })(Hy),
  U0 = (function (r) {
    function t() {
      var e;
      return be(this, t), (e = Ne(this, t, arguments)), (e.type = F.Endnote), e;
    }
    return Me(t, r), _e(t);
  })(Hy),
  Gy = (function (r) {
    function t(e, n, a) {
      var i;
      return be(this, t), (i = Ne(this, t, [e, n])), (i._documentParser = a), i;
    }
    return Me(t, r), _e(t);
  })(Ar),
  z0 = (function (r) {
    function t(e, n, a) {
      return be(this, t), Ne(this, t, [e, n, a]);
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            this.notes = this._documentParser.parseNotes(n, 'footnote', L0);
          },
        },
      ])
    );
  })(Gy),
  W0 = (function (r) {
    function t(e, n, a) {
      return be(this, t), Ne(this, t, [e, n, a]);
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            this.notes = this._documentParser.parseNotes(n, 'endnote', U0);
          },
        },
      ])
    );
  })(Gy);
function Mv(r, t) {
  var e = { defaultNoteIds: [] },
    n = pe(t.elements(r)),
    a;
  try {
    for (n.s(); !(a = n.n()).done; ) {
      var i = a.value;
      switch (i.localName) {
        case 'numFmt':
          e.nummeringFormat = t.attr(i, 'val');
          break;
        case 'footnote':
        case 'endnote':
          e.defaultNoteIds.push(t.attr(i, 'id'));
      }
    }
  } catch (o) {
    n.e(o);
  } finally {
    n.f();
  }
  return e;
}
var H0 = (function (r) {
    function t(e, n) {
      return be(this, t), Ne(this, t, [e, n]);
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            this.settings = (function (a, i) {
              var o = {},
                s = pe(i.elements(a)),
                u;
              try {
                for (s.s(); !(u = s.n()).done; ) {
                  var l = u.value;
                  switch (l.localName) {
                    case 'defaultTabStop':
                      o.defaultTabStop = i.lengthAttr(l, 'val');
                      break;
                    case 'footnotePr':
                      o.footnoteProps = Mv(l, i);
                      break;
                    case 'endnotePr':
                      o.endnoteProps = Mv(l, i);
                      break;
                    case 'autoHyphenation':
                      o.autoHyphenation = i.boolAttr(l, 'val');
                  }
                }
              } catch (c) {
                s.e(c);
              } finally {
                s.f();
              }
              return o;
            })(n, this._package.xmlParser);
          },
        },
      ])
    );
  })(Ar),
  G0 = (function (r) {
    function t() {
      return be(this, t), Ne(this, t, arguments);
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            this.props = (function (a, i) {
              return i.elements(a, 'property').map(function (o) {
                var s = o.firstChild;
                return {
                  formatId: i.attr(o, 'fmtid'),
                  name: i.attr(o, 'name'),
                  type: s.nodeName,
                  value: s.textContent,
                };
              });
            })(n, this._package.xmlParser);
          },
        },
      ])
    );
  })(Ar),
  V0 = (function (r) {
    function t(e, n, a) {
      var i;
      return be(this, t), (i = Ne(this, t, [e, n])), (i._documentParser = a), i;
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            (this.comments = this._documentParser.parseComments(n)),
              (this.commentMap = ut(this.comments, function (a) {
                return a.id;
              }));
          },
        },
      ])
    );
  })(Ar),
  $0 = (function (r) {
    function t(e, n) {
      var a;
      return be(this, t), (a = Ne(this, t, [e, n])), (a.comments = []), a;
    }
    return (
      Me(t, r),
      _e(t, [
        {
          key: 'parseXml',
          value: function (n) {
            var a = this._package.xmlParser,
              i = pe(a.elements(n, 'commentEx')),
              o;
            try {
              for (i.s(); !(o = i.n()).done; ) {
                var s = o.value;
                this.comments.push({
                  paraId: a.attr(s, 'paraId'),
                  paraIdParent: a.attr(s, 'paraIdParent'),
                  done: a.boolAttr(s, 'done'),
                });
              }
            } catch (u) {
              i.e(u);
            } finally {
              i.f();
            }
            this.commentMap = ut(this.comments, function (u) {
              return u.paraId;
            });
          },
        },
      ])
    );
  })(Ar),
  K0 = [
    { type: $e.OfficeDocument, target: 'word/document.xml' },
    { type: $e.ExtendedProperties, target: 'docProps/app.xml' },
    { type: $e.CoreProperties, target: 'docProps/core.xml' },
    { type: $e.CustomProperties, target: 'docProps/custom.xml' },
  ],
  Z0 = (function () {
    function r() {
      be(this, r), (this.parts = []), (this.partsMap = {});
    }
    return _e(
      r,
      [
        {
          key: 'save',
          value: function () {
            var e = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 'blob';
            return this._package.save(e);
          },
        },
        {
          key: 'loadRelationshipPart',
          value: (function () {
            var t = Sr(
              Ie().mark(function n(a, i) {
                var o,
                  s = this,
                  u,
                  l,
                  c,
                  h;
                return Ie().wrap(
                  function (f) {
                    for (;;)
                      switch ((f.prev = f.next)) {
                        case 0:
                          if (!this.partsMap[a]) {
                            f.next = 2;
                            break;
                          }
                          return f.abrupt('return', this.partsMap[a]);
                        case 2:
                          if (this._package.get(a)) {
                            f.next = 4;
                            break;
                          }
                          return f.abrupt('return', null);
                        case 4:
                          (u = null),
                            (f.t0 = i),
                            (f.next =
                              f.t0 === $e.OfficeDocument
                                ? 8
                                : f.t0 === $e.FontTable
                                ? 10
                                : f.t0 === $e.Numbering
                                ? 12
                                : f.t0 === $e.Styles
                                ? 14
                                : f.t0 === $e.Theme
                                ? 16
                                : f.t0 === $e.Footnotes
                                ? 18
                                : f.t0 === $e.Endnotes
                                ? 20
                                : f.t0 === $e.Footer
                                ? 22
                                : f.t0 === $e.Header
                                ? 24
                                : f.t0 === $e.CoreProperties
                                ? 26
                                : f.t0 === $e.ExtendedProperties
                                ? 28
                                : f.t0 === $e.CustomProperties
                                ? 30
                                : f.t0 === $e.Settings
                                ? 32
                                : f.t0 === $e.Comments
                                ? 34
                                : f.t0 === $e.CommentsExtended
                                ? 36
                                : 37);
                          break;
                        case 8:
                          return (
                            (this.documentPart = u = new b0(this._package, a, this._parser)), f.abrupt('break', 37)
                          );
                        case 10:
                          return (this.fontTablePart = u = new y0(this._package, a)), f.abrupt('break', 37);
                        case 12:
                          return (
                            (this.numberingPart = u = new x0(this._package, a, this._parser)), f.abrupt('break', 37)
                          );
                        case 14:
                          return (this.stylesPart = u = new P0(this._package, a, this._parser)), f.abrupt('break', 37);
                        case 16:
                          return (this.themePart = u = new j0(this._package, a)), f.abrupt('break', 37);
                        case 18:
                          return (
                            (this.footnotesPart = u = new z0(this._package, a, this._parser)), f.abrupt('break', 37)
                          );
                        case 20:
                          return (
                            (this.endnotesPart = u = new W0(this._package, a, this._parser)), f.abrupt('break', 37)
                          );
                        case 22:
                          return (u = new N0(this._package, a, this._parser)), f.abrupt('break', 37);
                        case 24:
                          return (u = new O0(this._package, a, this._parser)), f.abrupt('break', 37);
                        case 26:
                          return (this.corePropsPart = u = new F0(this._package, a)), f.abrupt('break', 37);
                        case 28:
                          return (this.extendedPropsPart = u = new M0(this._package, a)), f.abrupt('break', 37);
                        case 30:
                          return (u = new G0(this._package, a)), f.abrupt('break', 37);
                        case 32:
                          return (this.settingsPart = u = new H0(this._package, a)), f.abrupt('break', 37);
                        case 34:
                          return (
                            (this.commentsPart = u = new V0(this._package, a, this._parser)), f.abrupt('break', 37)
                          );
                        case 36:
                          this.commentsExtendedPart = u = new $0(this._package, a);
                        case 37:
                          if (u != null) {
                            f.next = 39;
                            break;
                          }
                          return f.abrupt('return', Promise.resolve(null));
                        case 39:
                          return (this.partsMap[a] = u), this.parts.push(u), (f.next = 43), u.load();
                        case 43:
                          if (!(((o = u.rels) === null || o === void 0 ? void 0 : o.length) > 0)) {
                            f.next = 47;
                            break;
                          }
                          return (
                            (l = Yn(u.path)),
                            (c = ct(l, 1)),
                            (h = c[0]),
                            (f.next = 47),
                            Promise.all(
                              u.rels.map(function (p) {
                                return s.loadRelationshipPart(ks(p.target, h), p.type);
                              })
                            )
                          );
                        case 47:
                          return f.abrupt('return', u);
                        case 48:
                        case 'end':
                          return f.stop();
                      }
                  },
                  n,
                  this
                );
              })
            );
            function e(n, a) {
              return t.apply(this, arguments);
            }
            return e;
          })(),
        },
        {
          key: 'loadDocumentImage',
          value: (function () {
            var t = Sr(
              Ie().mark(function n(a, i) {
                var o;
                return Ie().wrap(
                  function (u) {
                    for (;;)
                      switch ((u.prev = u.next)) {
                        case 0:
                          return (u.next = 2), this.loadResource(i ?? this.documentPart, a, 'blob');
                        case 2:
                          return (o = u.sent), u.abrupt('return', this.blobToURL(o));
                        case 4:
                        case 'end':
                          return u.stop();
                      }
                  },
                  n,
                  this
                );
              })
            );
            function e(n, a) {
              return t.apply(this, arguments);
            }
            return e;
          })(),
        },
        {
          key: 'loadNumberingImage',
          value: (function () {
            var t = Sr(
              Ie().mark(function n(a) {
                var i;
                return Ie().wrap(
                  function (s) {
                    for (;;)
                      switch ((s.prev = s.next)) {
                        case 0:
                          return (s.next = 2), this.loadResource(this.numberingPart, a, 'blob');
                        case 2:
                          return (i = s.sent), s.abrupt('return', this.blobToURL(i));
                        case 4:
                        case 'end':
                          return s.stop();
                      }
                  },
                  n,
                  this
                );
              })
            );
            function e(n) {
              return t.apply(this, arguments);
            }
            return e;
          })(),
        },
        {
          key: 'loadFont',
          value: (function () {
            var t = Sr(
              Ie().mark(function n(a, i) {
                var o;
                return Ie().wrap(
                  function (u) {
                    for (;;)
                      switch ((u.prev = u.next)) {
                        case 0:
                          return (u.next = 2), this.loadResource(this.fontTablePart, a, 'uint8array');
                        case 2:
                          return (o = u.sent), u.abrupt('return', o && this.blobToURL(new Blob([X0(o, i)])));
                        case 4:
                        case 'end':
                          return u.stop();
                      }
                  },
                  n,
                  this
                );
              })
            );
            function e(n, a) {
              return t.apply(this, arguments);
            }
            return e;
          })(),
        },
        {
          key: 'blobToURL',
          value: function (e) {
            return e
              ? this._options.useBase64URL
                ? (function (n) {
                    return new Promise(function (a, i) {
                      var o = new FileReader();
                      (o.onloadend = function () {
                        return a(o.result);
                      }),
                        (o.onerror = function () {
                          return i();
                        }),
                        o.readAsDataURL(n);
                    });
                  })(e)
                : URL.createObjectURL(e)
              : null;
          },
        },
        {
          key: 'findPartByRelId',
          value: function (e) {
            var n,
              a = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null,
              i = ((n = a.rels) !== null && n !== void 0 ? n : this.rels).find(function (s) {
                return s.id == e;
              }),
              o = a ? Yn(a.path)[0] : '';
            return i ? this.partsMap[ks(i.target, o)] : null;
          },
        },
        {
          key: 'getPathById',
          value: function (e, n) {
            var a = e.rels.find(function (u) {
                return u.id == n;
              }),
              i = Yn(e.path),
              o = ct(i, 1),
              s = o[0];
            return a ? ks(a.target, s) : null;
          },
        },
        {
          key: 'loadResource',
          value: function (e, n, a) {
            var i = this.getPathById(e, n);
            return i ? this._package.load(i, a) : Promise.resolve(null);
          },
        },
      ],
      [
        {
          key: 'load',
          value: (function () {
            var t = Sr(
              Ie().mark(function n(a, i, o) {
                var s;
                return Ie().wrap(function (l) {
                  for (;;)
                    switch ((l.prev = l.next)) {
                      case 0:
                        return (s = new r()), (s._options = o), (s._parser = i), (l.next = 5), g0.load(a, o);
                      case 5:
                        return (s._package = l.sent), (l.next = 8), s._package.loadRelationships();
                      case 8:
                        return (
                          (s.rels = l.sent),
                          (l.next = 11),
                          Promise.all(
                            K0.map(function (c) {
                              var h,
                                d =
                                  (h = s.rels.find(function (f) {
                                    return f.type === c.type;
                                  })) !== null && h !== void 0
                                    ? h
                                    : c;
                              return s.loadRelationshipPart(d.target, d.type);
                            })
                          )
                        );
                      case 11:
                        return l.abrupt('return', s);
                      case 12:
                      case 'end':
                        return l.stop();
                    }
                }, n);
              })
            );
            function e(n, a, i) {
              return t.apply(this, arguments);
            }
            return e;
          })(),
        },
      ]
    );
  })();
function X0(r, t) {
  for (var e = t.replace(/{|}|-/g, ''), n = new Array(16), a = 0; a < 16; a++)
    n[16 - a - 1] = parseInt(e.substr(2 * a, 2), 16);
  for (var i = 0; i < 32; i++) r[i] = r[i] ^ n[i % 16];
  return r;
}
function Y0(r, t) {
  return { type: F.BookmarkEnd, id: t.attr(r, 'id') };
}
var J0 = (function (r) {
  function t() {
    var e;
    return be(this, t), (e = Ne(this, t, arguments)), (e.type = F.VmlElement), (e.attrs = {}), e;
  }
  return Me(t, r), _e(t);
})(It);
function Vy(r, t) {
  var e,
    n = new J0();
  switch (r.localName) {
    case 'rect':
      (n.tagName = 'rect'), Object.assign(n.attrs, { width: '100%', height: '100%' });
      break;
    case 'oval':
      (n.tagName = 'ellipse'), Object.assign(n.attrs, { cx: '50%', cy: '50%', rx: '50%', ry: '50%' });
      break;
    case 'line':
      n.tagName = 'line';
      break;
    case 'shape':
      n.tagName = 'g';
      break;
    case 'textbox':
      (n.tagName = 'foreignObject'), Object.assign(n.attrs, { width: '100%', height: '100%' });
      break;
    default:
      return null;
  }
  var a = pe(O.attrs(r)),
    i;
  try {
    for (a.s(); !(i = a.n()).done; ) {
      var o = i.value;
      switch (o.localName) {
        case 'style':
          n.cssStyleText = o.value;
          break;
        case 'fillcolor':
          n.attrs.fill = o.value;
          break;
        case 'from':
          var s = Fv(o.value),
            u = ct(s, 2),
            l = u[0],
            c = u[1];
          Object.assign(n.attrs, { x1: l, y1: c });
          break;
        case 'to':
          var h = Fv(o.value),
            d = ct(h, 2),
            f = d[0],
            p = d[1];
          Object.assign(n.attrs, { x2: f, y2: p });
      }
    }
  } catch (g) {
    a.e(g);
  } finally {
    a.f();
  }
  var v = pe(O.elements(r)),
    y;
  try {
    for (v.s(); !(y = v.n()).done; ) {
      var E = y.value;
      switch (E.localName) {
        case 'stroke':
          Object.assign(n.attrs, Q0(E));
          break;
        case 'fill':
          Object.assign(n.attrs, {});
          break;
        case 'imagedata':
          (n.tagName = 'image'),
            Object.assign(n.attrs, { width: '100%', height: '100%' }),
            (n.imageHref = { id: O.attr(E, 'id'), title: O.attr(E, 'title') });
          break;
        case 'txbxContent':
          (e = n.children).push.apply(e, wt(t.parseBodyElements(E)));
          break;
        default:
          var _ = Vy(E, t);
          _ && n.children.push(_);
      }
    }
  } catch (g) {
    v.e(g);
  } finally {
    v.f();
  }
  return n;
}
function Q0(r) {
  var t;
  return {
    stroke: O.attr(r, 'color'),
    'stroke-width': (t = O.lengthAttr(r, 'weight', Wr)) !== null && t !== void 0 ? t : '1px',
  };
}
function Fv(r) {
  return r.split(',');
}
var ew = (function (r) {
    function t() {
      var e;
      return be(this, t), (e = Ne(this, t, arguments)), (e.type = F.Comment), e;
    }
    return Me(t, r), _e(t);
  })(It),
  rw = (function (r) {
    function t(e) {
      var n;
      return be(this, t), (n = Ne(this, t)), (n.id = e), (n.type = F.CommentReference), n;
    }
    return Me(t, r), _e(t);
  })(It),
  tw = (function (r) {
    function t(e) {
      var n;
      return be(this, t), (n = Ne(this, t)), (n.id = e), (n.type = F.CommentRangeStart), n;
    }
    return Me(t, r), _e(t);
  })(It),
  nw = (function (r) {
    function t(e) {
      var n;
      return be(this, t), (n = Ne(this, t)), (n.id = e), (n.type = F.CommentRangeEnd), n;
    }
    return Me(t, r), _e(t);
  })(It),
  aw = 'inherit',
  iw = 'black',
  ow = 'black',
  sw = 'transparent',
  uw = [],
  qv = {
    oMath: F.MmlMath,
    oMathPara: F.MmlMathParagraph,
    f: F.MmlFraction,
    func: F.MmlFunction,
    fName: F.MmlFunctionName,
    num: F.MmlNumerator,
    den: F.MmlDenominator,
    rad: F.MmlRadical,
    deg: F.MmlDegree,
    e: F.MmlBase,
    sSup: F.MmlSuperscript,
    sSub: F.MmlSubscript,
    sPre: F.MmlPreSubSuper,
    sup: F.MmlSuperArgument,
    sub: F.MmlSubArgument,
    d: F.MmlDelimiter,
    nary: F.MmlNary,
    eqArr: F.MmlEquationArray,
    lim: F.MmlLimit,
    limLow: F.MmlLimitLower,
    m: F.MmlMatrix,
    mr: F.MmlMatrixRow,
    box: F.MmlBox,
    bar: F.MmlBar,
    groupChr: F.MmlGroupChar,
  },
  lw = (function () {
    function r(t) {
      be(this, r), (this.options = nr({ ignoreWidth: !1, debug: !1 }, t));
    }
    return _e(r, [
      {
        key: 'parseNotes',
        value: function (e, n, a) {
          var i = [],
            o = pe(O.elements(e, n)),
            s;
          try {
            for (o.s(); !(s = o.n()).done; ) {
              var u = s.value,
                l = new a();
              (l.id = O.attr(u, 'id')),
                (l.noteType = O.attr(u, 'type')),
                (l.children = this.parseBodyElements(u)),
                i.push(l);
            }
          } catch (c) {
            o.e(c);
          } finally {
            o.f();
          }
          return i;
        },
      },
      {
        key: 'parseComments',
        value: function (e) {
          var n = [],
            a = pe(O.elements(e, 'comment')),
            i;
          try {
            for (a.s(); !(i = a.n()).done; ) {
              var o = i.value,
                s = new ew();
              (s.id = O.attr(o, 'id')),
                (s.author = O.attr(o, 'author')),
                (s.initials = O.attr(o, 'initials')),
                (s.date = O.attr(o, 'date')),
                (s.children = this.parseBodyElements(o)),
                n.push(s);
            }
          } catch (u) {
            a.e(u);
          } finally {
            a.f();
          }
          return n;
        },
      },
      {
        key: 'parseDocumentFile',
        value: function (e) {
          var n = O.element(e, 'body'),
            a = O.element(e, 'background'),
            i = O.element(n, 'sectPr');
          return {
            type: F.Document,
            children: this.parseBodyElements(n),
            props: i ? jy(i, O) : {},
            cssStyle: a ? this.parseBackground(a) : {},
          };
        },
      },
      {
        key: 'parseBackground',
        value: function (e) {
          var n = {},
            a = Le.colorAttr(e, 'color');
          return a && (n['background-color'] = a), n;
        },
      },
      {
        key: 'parseBodyElements',
        value: function (e) {
          var n = this,
            a = [],
            i = pe(O.elements(e)),
            o;
          try {
            for (i.s(); !(o = i.n()).done; ) {
              var s = o.value;
              switch (s.localName) {
                case 'p':
                  a.push(this.parseParagraph(s));
                  break;
                case 'tbl':
                  a.push(this.parseTable(s));
                  break;
                case 'sdt':
                  a.push.apply(
                    a,
                    wt(
                      this.parseSdt(s, function (u) {
                        return n.parseBodyElements(u);
                      })
                    )
                  );
              }
            }
          } catch (u) {
            i.e(u);
          } finally {
            i.f();
          }
          return a;
        },
      },
      {
        key: 'parseStylesFile',
        value: function (e) {
          var n = this,
            a = [];
          return (
            Le.foreach(e, function (i) {
              switch (i.localName) {
                case 'style':
                  a.push(n.parseStyle(i));
                  break;
                case 'docDefaults':
                  a.push(n.parseDefaultStyles(i));
              }
            }),
            a
          );
        },
      },
      {
        key: 'parseDefaultStyles',
        value: function (e) {
          var n = this,
            a = { id: null, name: null, target: null, basedOn: null, styles: [] };
          return (
            Le.foreach(e, function (i) {
              switch (i.localName) {
                case 'rPrDefault':
                  var o = O.element(i, 'rPr');
                  o && a.styles.push({ target: 'span', values: n.parseDefaultProperties(o, {}) });
                  break;
                case 'pPrDefault':
                  var s = O.element(i, 'pPr');
                  s && a.styles.push({ target: 'p', values: n.parseDefaultProperties(s, {}) });
              }
            }),
            a
          );
        },
      },
      {
        key: 'parseStyle',
        value: function (e) {
          var n = this,
            a = {
              id: O.attr(e, 'styleId'),
              isDefault: O.boolAttr(e, 'default'),
              name: null,
              target: null,
              basedOn: null,
              styles: [],
              linked: null,
            };
          switch (O.attr(e, 'type')) {
            case 'paragraph':
              a.target = 'p';
              break;
            case 'table':
              a.target = 'table';
              break;
            case 'character':
              a.target = 'span';
          }
          return (
            Le.foreach(e, function (i) {
              switch (i.localName) {
                case 'basedOn':
                  a.basedOn = O.attr(i, 'val');
                  break;
                case 'name':
                  a.name = O.attr(i, 'val');
                  break;
                case 'link':
                  a.linked = O.attr(i, 'val');
                  break;
                case 'next':
                  a.next = O.attr(i, 'val');
                  break;
                case 'aliases':
                  a.aliases = O.attr(i, 'val').split(',');
                  break;
                case 'pPr':
                  a.styles.push({ target: 'p', values: n.parseDefaultProperties(i, {}) }),
                    (a.paragraphProps = Ly(i, O));
                  break;
                case 'rPr':
                  a.styles.push({ target: 'span', values: n.parseDefaultProperties(i, {}) }), (a.runProps = pu(i, O));
                  break;
                case 'tblPr':
                case 'tcPr':
                  a.styles.push({ target: 'td', values: n.parseDefaultProperties(i, {}) });
                  break;
                case 'tblStylePr':
                  var o = pe(n.parseTableStyle(i)),
                    s;
                  try {
                    for (o.s(); !(s = o.n()).done; ) {
                      var u = s.value;
                      a.styles.push(u);
                    }
                  } catch (l) {
                    o.e(l);
                  } finally {
                    o.f();
                  }
                  break;
                case 'rsid':
                case 'qFormat':
                case 'hidden':
                case 'semiHidden':
                case 'unhideWhenUsed':
                case 'autoRedefine':
                case 'uiPriority':
                  break;
                default:
                  n.options.debug && console.warn('DOCX: Unknown style element: '.concat(i.localName));
              }
            }),
            a
          );
        },
      },
      {
        key: 'parseTableStyle',
        value: function (e) {
          var n = this,
            a = [],
            i = O.attr(e, 'type'),
            o = '',
            s = '';
          switch (i) {
            case 'firstRow':
              (s = '.first-row'), (o = 'tr.first-row td');
              break;
            case 'lastRow':
              (s = '.last-row'), (o = 'tr.last-row td');
              break;
            case 'firstCol':
              (s = '.first-col'), (o = 'td.first-col');
              break;
            case 'lastCol':
              (s = '.last-col'), (o = 'td.last-col');
              break;
            case 'band1Vert':
              (s = ':not(.no-vband)'), (o = 'td.odd-col');
              break;
            case 'band2Vert':
              (s = ':not(.no-vband)'), (o = 'td.even-col');
              break;
            case 'band1Horz':
              (s = ':not(.no-hband)'), (o = 'tr.odd-row');
              break;
            case 'band2Horz':
              (s = ':not(.no-hband)'), (o = 'tr.even-row');
              break;
            default:
              return [];
          }
          return (
            Le.foreach(e, function (u) {
              switch (u.localName) {
                case 'pPr':
                  a.push({ target: ''.concat(o, ' p'), mod: s, values: n.parseDefaultProperties(u, {}) });
                  break;
                case 'rPr':
                  a.push({ target: ''.concat(o, ' span'), mod: s, values: n.parseDefaultProperties(u, {}) });
                  break;
                case 'tblPr':
                case 'tcPr':
                  a.push({ target: o, mod: s, values: n.parseDefaultProperties(u, {}) });
              }
            }),
            a
          );
        },
      },
      {
        key: 'parseNumberingFile',
        value: function (e) {
          var n = this,
            a = [],
            i = {},
            o = [];
          return (
            Le.foreach(e, function (s) {
              switch (s.localName) {
                case 'abstractNum':
                  n.parseAbstractNumbering(s, o).forEach(function (c) {
                    return a.push(c);
                  });
                  break;
                case 'numPicBullet':
                  o.push(n.parseNumberingPicBullet(s));
                  break;
                case 'num':
                  var u = O.attr(s, 'numId'),
                    l = O.elementAttr(s, 'abstractNumId', 'val');
                  i[l] = u;
              }
            }),
            a.forEach(function (s) {
              return (s.id = i[s.id]);
            }),
            a
          );
        },
      },
      {
        key: 'parseNumberingPicBullet',
        value: function (e) {
          var n = O.element(e, 'pict'),
            a = n && O.element(n, 'shape'),
            i = a && O.element(a, 'imagedata');
          return i ? { id: O.intAttr(e, 'numPicBulletId'), src: O.attr(i, 'id'), style: O.attr(a, 'style') } : null;
        },
      },
      {
        key: 'parseAbstractNumbering',
        value: function (e, n) {
          var a = this,
            i = [],
            o = O.attr(e, 'abstractNumId');
          return (
            Le.foreach(e, function (s) {
              s.localName === 'lvl' && i.push(a.parseNumberingLevel(o, s, n));
            }),
            i
          );
        },
      },
      {
        key: 'parseNumberingLevel',
        value: function (e, n, a) {
          var i = this,
            o = {
              id: e,
              level: O.intAttr(n, 'ilvl'),
              start: 1,
              pStyleName: void 0,
              pStyle: {},
              rStyle: {},
              suff: 'tab',
            };
          return (
            Le.foreach(n, function (s) {
              switch (s.localName) {
                case 'start':
                  o.start = O.intAttr(s, 'val');
                  break;
                case 'pPr':
                  i.parseDefaultProperties(s, o.pStyle);
                  break;
                case 'rPr':
                  i.parseDefaultProperties(s, o.rStyle);
                  break;
                case 'lvlPicBulletId':
                  var u = O.intAttr(s, 'val');
                  o.bullet = a.find(function (l) {
                    return l?.id == u;
                  });
                  break;
                case 'lvlText':
                  o.levelText = O.attr(s, 'val');
                  break;
                case 'pStyle':
                  o.pStyleName = O.attr(s, 'val');
                  break;
                case 'numFmt':
                  o.format = O.attr(s, 'val');
                  break;
                case 'suff':
                  o.suff = O.attr(s, 'val');
              }
            }),
            o
          );
        },
      },
      {
        key: 'parseSdt',
        value: function (e, n) {
          var a = O.element(e, 'sdtContent');
          return a ? n(a) : [];
        },
      },
      {
        key: 'parseInserted',
        value: function (e, n) {
          var a, i;
          return {
            type: F.Inserted,
            children: (a = (i = n(e)) === null || i === void 0 ? void 0 : i.children) !== null && a !== void 0 ? a : [],
          };
        },
      },
      {
        key: 'parseDeleted',
        value: function (e, n) {
          var a, i;
          return {
            type: F.Deleted,
            children: (a = (i = n(e)) === null || i === void 0 ? void 0 : i.children) !== null && a !== void 0 ? a : [],
          };
        },
      },
      {
        key: 'parseParagraph',
        value: function (e) {
          var n,
            a = this,
            i,
            o,
            s = { type: F.Paragraph, children: [] },
            u = pe(O.elements(e)),
            l;
          try {
            for (u.s(); !(l = u.n()).done; ) {
              var c = l.value;
              switch (c.localName) {
                case 'pPr':
                  this.parseParagraphProperties(c, s);
                  break;
                case 'r':
                  s.children.push(this.parseRun(c, s));
                  break;
                case 'hyperlink':
                  s.children.push(this.parseHyperlink(c, s));
                  break;
                case 'smartTag':
                  s.children.push(this.parseSmartTag(c, s));
                  break;
                case 'bookmarkStart':
                  s.children.push(
                    ((i = c),
                    (o = O),
                    {
                      type: F.BookmarkStart,
                      id: o.attr(i, 'id'),
                      name: o.attr(i, 'name'),
                      colFirst: o.intAttr(i, 'colFirst'),
                      colLast: o.intAttr(i, 'colLast'),
                    })
                  );
                  break;
                case 'bookmarkEnd':
                  s.children.push(Y0(c, O));
                  break;
                case 'commentRangeStart':
                  s.children.push(new tw(O.attr(c, 'id')));
                  break;
                case 'commentRangeEnd':
                  s.children.push(new nw(O.attr(c, 'id')));
                  break;
                case 'oMath':
                case 'oMathPara':
                  s.children.push(this.parseMathElement(c));
                  break;
                case 'sdt':
                  (n = s.children).push.apply(
                    n,
                    wt(
                      this.parseSdt(c, function (h) {
                        return a.parseParagraph(h).children;
                      })
                    )
                  );
                  break;
                case 'ins':
                  s.children.push(
                    this.parseInserted(c, function (h) {
                      return a.parseParagraph(h);
                    })
                  );
                  break;
                case 'del':
                  s.children.push(
                    this.parseDeleted(c, function (h) {
                      return a.parseParagraph(h);
                    })
                  );
              }
            }
          } catch (h) {
            u.e(h);
          } finally {
            u.f();
          }
          return s;
        },
      },
      {
        key: 'parseParagraphProperties',
        value: function (e, n) {
          var a = this;
          this.parseDefaultProperties(e, (n.cssStyle = {}), null, function (i) {
            if (Uy(i, n, O)) return !0;
            switch (i.localName) {
              case 'pStyle':
                n.styleName = O.attr(i, 'val');
                break;
              case 'cnfStyle':
                n.className = qe.classNameOfCnfStyle(i);
                break;
              case 'framePr':
                a.parseFrame(i, n);
                break;
              case 'rPr':
                break;
              default:
                return !1;
            }
            return !0;
          });
        },
      },
      {
        key: 'parseFrame',
        value: function (e, n) {
          O.attr(e, 'dropCap') == 'drop' && (n.cssStyle.float = 'left');
        },
      },
      {
        key: 'parseHyperlink',
        value: function (e, n) {
          var a = this,
            i = { type: F.Hyperlink, parent: n, children: [] },
            o = O.attr(e, 'anchor'),
            s = O.attr(e, 'id');
          return (
            o && (i.href = '#' + o),
            s && (i.id = s),
            Le.foreach(e, function (u) {
              u.localName === 'r' && i.children.push(a.parseRun(u, i));
            }),
            i
          );
        },
      },
      {
        key: 'parseSmartTag',
        value: function (e, n) {
          var a = this,
            i = { type: F.SmartTag, parent: n, children: [] },
            o = O.attr(e, 'uri'),
            s = O.attr(e, 'element');
          return (
            o && (i.uri = o),
            s && (i.element = s),
            Le.foreach(e, function (u) {
              u.localName === 'r' && i.children.push(a.parseRun(u, i));
            }),
            i
          );
        },
      },
      {
        key: 'parseRun',
        value: function (e, n) {
          var a = this,
            i = { type: F.Run, parent: n, children: [] };
          return (
            Le.foreach(e, function (o) {
              switch ((o = a.checkAlternateContent(o)).localName) {
                case 't':
                  i.children.push({ type: F.Text, text: o.textContent });
                  break;
                case 'delText':
                  i.children.push({ type: F.DeletedText, text: o.textContent });
                  break;
                case 'commentReference':
                  i.children.push(new rw(O.attr(o, 'id')));
                  break;
                case 'fldSimple':
                  i.children.push({
                    type: F.SimpleField,
                    instruction: O.attr(o, 'instr'),
                    lock: O.boolAttr(o, 'lock', !1),
                    dirty: O.boolAttr(o, 'dirty', !1),
                  });
                  break;
                case 'instrText':
                  (i.fieldRun = !0), i.children.push({ type: F.Instruction, text: o.textContent });
                  break;
                case 'fldChar':
                  (i.fieldRun = !0),
                    i.children.push({
                      type: F.ComplexField,
                      charType: O.attr(o, 'fldCharType'),
                      lock: O.boolAttr(o, 'lock', !1),
                      dirty: O.boolAttr(o, 'dirty', !1),
                    });
                  break;
                case 'noBreakHyphen':
                  i.children.push({ type: F.NoBreakHyphen });
                  break;
                case 'br':
                  i.children.push({ type: F.Break, break: O.attr(o, 'type') || 'textWrapping' });
                  break;
                case 'lastRenderedPageBreak':
                  i.children.push({ type: F.Break, break: 'lastRenderedPageBreak' });
                  break;
                case 'sym':
                  i.children.push({ type: F.Symbol, font: O.attr(o, 'font'), char: O.attr(o, 'char') });
                  break;
                case 'tab':
                  i.children.push({ type: F.Tab });
                  break;
                case 'footnoteReference':
                  i.children.push({ type: F.FootnoteReference, id: O.attr(o, 'id') });
                  break;
                case 'endnoteReference':
                  i.children.push({ type: F.EndnoteReference, id: O.attr(o, 'id') });
                  break;
                case 'drawing':
                  var s = a.parseDrawing(o);
                  s && (i.children = [s]);
                  break;
                case 'pict':
                  i.children.push(a.parseVmlPicture(o));
                  break;
                case 'rPr':
                  a.parseRunProperties(o, i);
              }
            }),
            i
          );
        },
      },
      {
        key: 'parseMathElement',
        value: function (e) {
          var n = ''.concat(e.localName, 'Pr'),
            a = { type: qv[e.localName], children: [] },
            i = pe(O.elements(e)),
            o;
          try {
            for (i.s(); !(o = i.n()).done; ) {
              var s = o.value;
              if (qv[s.localName]) a.children.push(this.parseMathElement(s));
              else if (s.localName == 'r') {
                var u = this.parseRun(s);
                (u.type = F.MmlRun), a.children.push(u);
              } else s.localName == n && (a.props = this.parseMathProperies(s));
            }
          } catch (l) {
            i.e(l);
          } finally {
            i.f();
          }
          return a;
        },
      },
      {
        key: 'parseMathProperies',
        value: function (e) {
          var n = {},
            a = pe(O.elements(e)),
            i;
          try {
            for (a.s(); !(i = a.n()).done; ) {
              var o = i.value;
              switch (o.localName) {
                case 'chr':
                  n.char = O.attr(o, 'val');
                  break;
                case 'vertJc':
                  n.verticalJustification = O.attr(o, 'val');
                  break;
                case 'pos':
                  n.position = O.attr(o, 'val');
                  break;
                case 'degHide':
                  n.hideDegree = O.boolAttr(o, 'val');
                  break;
                case 'begChr':
                  n.beginChar = O.attr(o, 'val');
                  break;
                case 'endChr':
                  n.endChar = O.attr(o, 'val');
              }
            }
          } catch (s) {
            a.e(s);
          } finally {
            a.f();
          }
          return n;
        },
      },
      {
        key: 'parseRunProperties',
        value: function (e, n) {
          this.parseDefaultProperties(e, (n.cssStyle = {}), null, function (a) {
            switch (a.localName) {
              case 'rStyle':
                n.styleName = O.attr(a, 'val');
                break;
              case 'vertAlign':
                n.verticalAlign = qe.valueOfVertAlign(a, !0);
                break;
              default:
                return !1;
            }
            return !0;
          });
        },
      },
      {
        key: 'parseVmlPicture',
        value: function (e) {
          var n = { type: F.VmlPicture, children: [] },
            a = pe(O.elements(e)),
            i;
          try {
            for (a.s(); !(i = a.n()).done; ) {
              var o = i.value,
                s = Vy(o, this);
              s && n.children.push(s);
            }
          } catch (u) {
            a.e(u);
          } finally {
            a.f();
          }
          return n;
        },
      },
      {
        key: 'checkAlternateContent',
        value: function (e) {
          var n;
          if (e.localName != 'AlternateContent') return e;
          var a = O.element(e, 'Choice');
          if (a) {
            var i = O.attr(a, 'Requires'),
              o = e.lookupNamespaceURI(i);
            if (uw.includes(o)) return a.firstElementChild;
          }
          return (n = O.element(e, 'Fallback')) === null || n === void 0 ? void 0 : n.firstElementChild;
        },
      },
      {
        key: 'parseDrawing',
        value: function (e) {
          var n = pe(O.elements(e)),
            a;
          try {
            for (n.s(); !(a = n.n()).done; ) {
              var i = a.value;
              switch (i.localName) {
                case 'inline':
                case 'anchor':
                  return this.parseDrawingWrapper(i);
              }
            }
          } catch (o) {
            n.e(o);
          } finally {
            n.f();
          }
        },
      },
      {
        key: 'parseDrawingWrapper',
        value: function (e) {
          var n = { type: F.Drawing, children: [], cssStyle: {} },
            a = e.localName == 'anchor',
            i = null,
            o = O.boolAttr(e, 'simplePos');
          O.boolAttr(e, 'behindDoc');
          var s = { relative: 'page', align: 'left', offset: '0' },
            u = { relative: 'page', align: 'top', offset: '0' },
            l = pe(O.elements(e)),
            c;
          try {
            for (l.s(); !(c = l.n()).done; ) {
              var h = c.value;
              switch (h.localName) {
                case 'simplePos':
                  o && ((s.offset = O.lengthAttr(h, 'x', Wr)), (u.offset = O.lengthAttr(h, 'y', Wr)));
                  break;
                case 'extent':
                  (n.cssStyle.width = O.lengthAttr(h, 'cx', Wr)), (n.cssStyle.height = O.lengthAttr(h, 'cy', Wr));
                  break;
                case 'positionH':
                case 'positionV':
                  if (!o) {
                    var d,
                      f = h.localName == 'positionH' ? s : u,
                      p = O.element(h, 'align'),
                      v = O.element(h, 'posOffset');
                    (f.relative = (d = O.attr(h, 'relativeFrom')) !== null && d !== void 0 ? d : f.relative),
                      p && (f.align = p.textContent),
                      v && (f.offset = Le.sizeValue(v, Wr));
                  }
                  break;
                case 'wrapTopAndBottom':
                  i = 'wrapTopAndBottom';
                  break;
                case 'wrapNone':
                  i = 'wrapNone';
                  break;
                case 'graphic':
                  var y = this.parseGraphic(h);
                  y && n.children.push(y);
              }
            }
          } catch (E) {
            l.e(E);
          } finally {
            l.f();
          }
          return (
            i == 'wrapTopAndBottom'
              ? ((n.cssStyle.display = 'block'),
                s.align && ((n.cssStyle['text-align'] = s.align), (n.cssStyle.width = '100%')))
              : i == 'wrapNone'
              ? ((n.cssStyle.display = 'block'),
                (n.cssStyle.position = 'relative'),
                (n.cssStyle.width = '0px'),
                (n.cssStyle.height = '0px'),
                s.offset && (n.cssStyle.left = s.offset),
                u.offset && (n.cssStyle.top = u.offset))
              : !a || (s.align != 'left' && s.align != 'right') || (n.cssStyle.float = s.align),
            n
          );
        },
      },
      {
        key: 'parseGraphic',
        value: function (e) {
          var n = O.element(e, 'graphicData'),
            a = pe(O.elements(n)),
            i;
          try {
            for (a.s(); !(i = a.n()).done; ) {
              var o = i.value;
              if (o.localName === 'pic') return this.parsePicture(o);
            }
          } catch (s) {
            a.e(s);
          } finally {
            a.f();
          }
          return null;
        },
      },
      {
        key: 'parsePicture',
        value: function (e) {
          var n = { type: F.Image, src: '', cssStyle: {} },
            a = O.element(e, 'blipFill'),
            i = O.element(a, 'blip');
          n.src = O.attr(i, 'embed');
          var o = O.element(e, 'spPr'),
            s = O.element(o, 'xfrm'),
            u = pe(((n.cssStyle.position = 'relative'), O.elements(s))),
            l;
          try {
            for (u.s(); !(l = u.n()).done; ) {
              var c = l.value;
              switch (c.localName) {
                case 'ext':
                  (n.cssStyle.width = O.lengthAttr(c, 'cx', Wr)), (n.cssStyle.height = O.lengthAttr(c, 'cy', Wr));
                  break;
                case 'off':
                  (n.cssStyle.left = O.lengthAttr(c, 'x', Wr)), (n.cssStyle.top = O.lengthAttr(c, 'y', Wr));
              }
            }
          } catch (h) {
            u.e(h);
          } finally {
            u.f();
          }
          return n;
        },
      },
      {
        key: 'parseTable',
        value: function (e) {
          var n = this,
            a = { type: F.Table, children: [] };
          return (
            Le.foreach(e, function (i) {
              switch (i.localName) {
                case 'tr':
                  a.children.push(n.parseTableRow(i));
                  break;
                case 'tblGrid':
                  a.columns = n.parseTableColumns(i);
                  break;
                case 'tblPr':
                  n.parseTableProperties(i, a);
              }
            }),
            a
          );
        },
      },
      {
        key: 'parseTableColumns',
        value: function (e) {
          var n = [];
          return (
            Le.foreach(e, function (a) {
              a.localName === 'gridCol' && n.push({ width: O.lengthAttr(a, 'w') });
            }),
            n
          );
        },
      },
      {
        key: 'parseTableProperties',
        value: function (e, n) {
          var a = this;
          switch (
            ((n.cssStyle = {}),
            (n.cellStyle = {}),
            this.parseDefaultProperties(e, n.cssStyle, n.cellStyle, function (i) {
              switch (i.localName) {
                case 'tblStyle':
                  n.styleName = O.attr(i, 'val');
                  break;
                case 'tblLook':
                  n.className = qe.classNameOftblLook(i);
                  break;
                case 'tblpPr':
                  a.parseTablePosition(i, n);
                  break;
                case 'tblStyleColBandSize':
                  n.colBandSize = O.intAttr(i, 'val');
                  break;
                case 'tblStyleRowBandSize':
                  n.rowBandSize = O.intAttr(i, 'val');
                  break;
                default:
                  return !1;
              }
              return !0;
            }),
            n.cssStyle['text-align'])
          ) {
            case 'center':
              delete n.cssStyle['text-align'],
                (n.cssStyle['margin-left'] = 'auto'),
                (n.cssStyle['margin-right'] = 'auto');
              break;
            case 'right':
              delete n.cssStyle['text-align'], (n.cssStyle['margin-left'] = 'auto');
          }
        },
      },
      {
        key: 'parseTablePosition',
        value: function (e, n) {
          var a = O.lengthAttr(e, 'topFromText'),
            i = O.lengthAttr(e, 'bottomFromText'),
            o = O.lengthAttr(e, 'rightFromText'),
            s = O.lengthAttr(e, 'leftFromText');
          (n.cssStyle.float = 'left'),
            (n.cssStyle['margin-bottom'] = qe.addSize(n.cssStyle['margin-bottom'], i)),
            (n.cssStyle['margin-left'] = qe.addSize(n.cssStyle['margin-left'], s)),
            (n.cssStyle['margin-right'] = qe.addSize(n.cssStyle['margin-right'], o)),
            (n.cssStyle['margin-top'] = qe.addSize(n.cssStyle['margin-top'], a));
        },
      },
      {
        key: 'parseTableRow',
        value: function (e) {
          var n = this,
            a = { type: F.Row, children: [] };
          return (
            Le.foreach(e, function (i) {
              switch (i.localName) {
                case 'tc':
                  a.children.push(n.parseTableCell(i));
                  break;
                case 'trPr':
                  n.parseTableRowProperties(i, a);
              }
            }),
            a
          );
        },
      },
      {
        key: 'parseTableRowProperties',
        value: function (e, n) {
          n.cssStyle = this.parseDefaultProperties(e, {}, null, function (a) {
            switch (a.localName) {
              case 'cnfStyle':
                n.className = qe.classNameOfCnfStyle(a);
                break;
              case 'tblHeader':
                n.isHeader = O.boolAttr(a, 'val');
                break;
              default:
                return !1;
            }
            return !0;
          });
        },
      },
      {
        key: 'parseTableCell',
        value: function (e) {
          var n = this,
            a = { type: F.Cell, children: [] };
          return (
            Le.foreach(e, function (i) {
              switch (i.localName) {
                case 'tbl':
                  a.children.push(n.parseTable(i));
                  break;
                case 'p':
                  a.children.push(n.parseParagraph(i));
                  break;
                case 'tcPr':
                  n.parseTableCellProperties(i, a);
              }
            }),
            a
          );
        },
      },
      {
        key: 'parseTableCellProperties',
        value: function (e, n) {
          n.cssStyle = this.parseDefaultProperties(e, {}, null, function (a) {
            var i;
            switch (a.localName) {
              case 'gridSpan':
                n.span = O.intAttr(a, 'val', null);
                break;
              case 'vMerge':
                n.verticalMerge = (i = O.attr(a, 'val')) !== null && i !== void 0 ? i : 'continue';
                break;
              case 'cnfStyle':
                n.className = qe.classNameOfCnfStyle(a);
                break;
              default:
                return !1;
            }
            return !0;
          });
        },
      },
      {
        key: 'parseDefaultProperties',
        value: function (e) {
          var n = this,
            a = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null,
            i = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : null,
            o = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : null;
          return (
            (a = a || {}),
            Le.foreach(e, function (s) {
              if (!(o != null && o(s)))
                switch (s.localName) {
                  case 'jc':
                    a['text-align'] = qe.valueOfJc(s);
                    break;
                  case 'textAlignment':
                    a['vertical-align'] = qe.valueOfTextAlignment(s);
                    break;
                  case 'color':
                    a.color = Le.colorAttr(s, 'val', null, iw);
                    break;
                  case 'sz':
                    a['font-size'] = a['min-height'] = O.lengthAttr(s, 'val', js);
                    break;
                  case 'shd':
                    a['background-color'] = Le.colorAttr(s, 'fill', null, aw);
                    break;
                  case 'highlight':
                    a['background-color'] = Le.colorAttr(s, 'val', null, sw);
                    break;
                  case 'vertAlign':
                    break;
                  case 'position':
                    a.verticalAlign = O.lengthAttr(s, 'val', js);
                    break;
                  case 'tcW':
                    if (n.options.ignoreWidth) break;
                  case 'tblW':
                    a.width = qe.valueOfSize(s, 'w');
                    break;
                  case 'trHeight':
                    n.parseTrHeight(s, a);
                    break;
                  case 'strike':
                    a['text-decoration'] = O.boolAttr(s, 'val', !0) ? 'line-through' : 'none';
                    break;
                  case 'b':
                    a['font-weight'] = O.boolAttr(s, 'val', !0) ? 'bold' : 'normal';
                    break;
                  case 'i':
                    a['font-style'] = O.boolAttr(s, 'val', !0) ? 'italic' : 'normal';
                    break;
                  case 'caps':
                    a['text-transform'] = O.boolAttr(s, 'val', !0) ? 'uppercase' : 'none';
                    break;
                  case 'smallCaps':
                    a['font-variant'] = O.boolAttr(s, 'val', !0) ? 'small-caps' : 'none';
                    break;
                  case 'u':
                    n.parseUnderline(s, a);
                    break;
                  case 'ind':
                  case 'tblInd':
                    n.parseIndentation(s, a);
                    break;
                  case 'rFonts':
                    n.parseFont(s, a);
                    break;
                  case 'tblBorders':
                    n.parseBorderProperties(s, i || a);
                    break;
                  case 'tblCellSpacing':
                    (a['border-spacing'] = qe.valueOfMargin(s)), (a['border-collapse'] = 'separate');
                    break;
                  case 'pBdr':
                    n.parseBorderProperties(s, a);
                    break;
                  case 'bdr':
                    a.border = qe.valueOfBorder(s);
                    break;
                  case 'tcBorders':
                    n.parseBorderProperties(s, a);
                    break;
                  case 'vanish':
                    O.boolAttr(s, 'val', !0) && (a.display = 'none');
                    break;
                  case 'kern':
                  case 'noWrap':
                    break;
                  case 'tblCellMar':
                  case 'tcMar':
                    n.parseMarginProperties(s, i || a);
                    break;
                  case 'tblLayout':
                    a['table-layout'] = qe.valueOfTblLayout(s);
                    break;
                  case 'vAlign':
                    a['vertical-align'] = qe.valueOfTextAlignment(s);
                    break;
                  case 'spacing':
                    e.localName == 'pPr' && n.parseSpacing(s, a);
                    break;
                  case 'wordWrap':
                    O.boolAttr(s, 'val') && (a['overflow-wrap'] = 'break-word');
                    break;
                  case 'suppressAutoHyphens':
                    a.hyphens = O.boolAttr(s, 'val', !0) ? 'none' : 'auto';
                    break;
                  case 'lang':
                    a.$lang = O.attr(s, 'val');
                    break;
                  case 'bCs':
                  case 'iCs':
                  case 'szCs':
                  case 'tabs':
                  case 'outlineLvl':
                  case 'contextualSpacing':
                  case 'tblStyleColBandSize':
                  case 'tblStyleRowBandSize':
                  case 'webHidden':
                  case 'pageBreakBefore':
                  case 'suppressLineNumbers':
                  case 'keepLines':
                  case 'keepNext':
                  case 'widowControl':
                  case 'bidi':
                  case 'rtl':
                  case 'noProof':
                    break;
                  default:
                    n.options.debug &&
                      console.warn('DOCX: Unknown document element: '.concat(e.localName, '.').concat(s.localName));
                }
            }),
            a
          );
        },
      },
      {
        key: 'parseUnderline',
        value: function (e, n) {
          var a = O.attr(e, 'val');
          if (a != null) {
            switch (a) {
              case 'dash':
              case 'dashDotDotHeavy':
              case 'dashDotHeavy':
              case 'dashedHeavy':
              case 'dashLong':
              case 'dashLongHeavy':
              case 'dotDash':
              case 'dotDotDash':
                n['text-decoration'] = 'underline dashed';
                break;
              case 'dotted':
              case 'dottedHeavy':
                n['text-decoration'] = 'underline dotted';
                break;
              case 'double':
                n['text-decoration'] = 'underline double';
                break;
              case 'single':
              case 'thick':
              case 'words':
                n['text-decoration'] = 'underline';
                break;
              case 'wave':
              case 'wavyDouble':
              case 'wavyHeavy':
                n['text-decoration'] = 'underline wavy';
                break;
              case 'none':
                n['text-decoration'] = 'none';
            }
            var i = Le.colorAttr(e, 'color');
            i && (n['text-decoration-color'] = i);
          }
        },
      },
      {
        key: 'parseFont',
        value: function (e, n) {
          var a = [O.attr(e, 'ascii'), qe.themeValue(e, 'asciiTheme')]
            .filter(function (i) {
              return i;
            })
            .join(', ');
          a.length > 0 && (n['font-family'] = a);
        },
      },
      {
        key: 'parseIndentation',
        value: function (e, n) {
          var a = O.lengthAttr(e, 'firstLine'),
            i = O.lengthAttr(e, 'hanging'),
            o = O.lengthAttr(e, 'left'),
            s = O.lengthAttr(e, 'start'),
            u = O.lengthAttr(e, 'right'),
            l = O.lengthAttr(e, 'end');
          a && (n['text-indent'] = a),
            i && (n['text-indent'] = '-'.concat(i)),
            (o || s) && (n['margin-left'] = o || s),
            (u || l) && (n['margin-right'] = u || l);
        },
      },
      {
        key: 'parseSpacing',
        value: function (e, n) {
          var a = O.lengthAttr(e, 'before'),
            i = O.lengthAttr(e, 'after'),
            o = O.intAttr(e, 'line', null),
            s = O.attr(e, 'lineRule');
          if ((a && (n['margin-top'] = a), i && (n['margin-bottom'] = i), o !== null))
            switch (s) {
              case 'auto':
                n['line-height'] = ''.concat((o / 240).toFixed(2));
                break;
              case 'atLeast':
                n['line-height'] = 'calc(100% + '.concat(o / 20, 'pt)');
                break;
              default:
                n['line-height'] = n['min-height'] = o / 20 + 'pt';
            }
        },
      },
      {
        key: 'parseMarginProperties',
        value: function (e, n) {
          Le.foreach(e, function (a) {
            switch (a.localName) {
              case 'left':
                n['padding-left'] = qe.valueOfMargin(a);
                break;
              case 'right':
                n['padding-right'] = qe.valueOfMargin(a);
                break;
              case 'top':
                n['padding-top'] = qe.valueOfMargin(a);
                break;
              case 'bottom':
                n['padding-bottom'] = qe.valueOfMargin(a);
            }
          });
        },
      },
      {
        key: 'parseTrHeight',
        value: function (e, n) {
          O.attr(e, 'hRule'), (n.height = O.lengthAttr(e, 'val'));
        },
      },
      {
        key: 'parseBorderProperties',
        value: function (e, n) {
          Le.foreach(e, function (a) {
            switch (a.localName) {
              case 'start':
              case 'left':
                n['border-left'] = qe.valueOfBorder(a);
                break;
              case 'end':
              case 'right':
                n['border-right'] = qe.valueOfBorder(a);
                break;
              case 'top':
                n['border-top'] = qe.valueOfBorder(a);
                break;
              case 'bottom':
                n['border-bottom'] = qe.valueOfBorder(a);
            }
          });
        },
      },
    ]);
  })(),
  cw = [
    'black',
    'blue',
    'cyan',
    'darkBlue',
    'darkCyan',
    'darkGray',
    'darkGreen',
    'darkMagenta',
    'darkRed',
    'darkYellow',
    'green',
    'lightGray',
    'magenta',
    'none',
    'red',
    'white',
    'yellow',
  ],
  Le = (function () {
    function r() {
      be(this, r);
    }
    return _e(r, null, [
      {
        key: 'foreach',
        value: function (e, n) {
          for (var a = 0; a < e.childNodes.length; a++) {
            var i = e.childNodes[a];
            i.nodeType == Node.ELEMENT_NODE && n(i);
          }
        },
      },
      {
        key: 'colorAttr',
        value: function (e, n) {
          var a = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : null,
            i = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : 'black',
            o = O.attr(e, n);
          if (o) return o == 'auto' ? i : cw.includes(o) ? o : '#'.concat(o);
          var s = O.attr(e, 'themeColor');
          return s ? 'var(--docx-'.concat(s, '-color)') : a;
        },
      },
      {
        key: 'sizeValue',
        value: function (e) {
          var n = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : ma;
          return qy(e.textContent, n);
        },
      },
    ]);
  })(),
  qe = (function () {
    function r() {
      be(this, r);
    }
    return _e(r, null, [
      {
        key: 'themeValue',
        value: function (e, n) {
          var a = O.attr(e, n);
          return a ? 'var(--docx-'.concat(a, '-font)') : null;
        },
      },
      {
        key: 'valueOfSize',
        value: function (e, n) {
          var a = ma;
          switch (O.attr(e, 'type')) {
            case 'dxa':
              break;
            case 'pct':
              a = d0;
              break;
            case 'auto':
              return 'auto';
          }
          return O.lengthAttr(e, n, a);
        },
      },
      {
        key: 'valueOfMargin',
        value: function (e) {
          return O.lengthAttr(e, 'w');
        },
      },
      {
        key: 'valueOfBorder',
        value: function (e) {
          if (O.attr(e, 'val') == 'nil') return 'none';
          var n = Le.colorAttr(e, 'color');
          return ''.concat(O.lengthAttr(e, 'sz', Fy), ' solid ').concat(n == 'auto' ? ow : n);
        },
      },
      {
        key: 'valueOfTblLayout',
        value: function (e) {
          return O.attr(e, 'val') == 'fixed' ? 'fixed' : 'auto';
        },
      },
      {
        key: 'classNameOfCnfStyle',
        value: function (e) {
          var n = O.attr(e, 'val');
          return [
            'first-row',
            'last-row',
            'first-col',
            'last-col',
            'odd-col',
            'even-col',
            'odd-row',
            'even-row',
            'ne-cell',
            'nw-cell',
            'se-cell',
            'sw-cell',
          ]
            .filter(function (a, i) {
              return n[i] == '1';
            })
            .join(' ');
        },
      },
      {
        key: 'valueOfJc',
        value: function (e) {
          var n = O.attr(e, 'val');
          switch (n) {
            case 'start':
            case 'left':
              return 'left';
            case 'center':
              return 'center';
            case 'end':
            case 'right':
              return 'right';
            case 'both':
              return 'justify';
          }
          return n;
        },
      },
      {
        key: 'valueOfVertAlign',
        value: function (e) {
          var n = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !1,
            a = O.attr(e, 'val');
          switch (a) {
            case 'subscript':
              return 'sub';
            case 'superscript':
              return n ? 'sup' : 'super';
          }
          return n ? null : a;
        },
      },
      {
        key: 'valueOfTextAlignment',
        value: function (e) {
          var n = O.attr(e, 'val');
          switch (n) {
            case 'auto':
            case 'baseline':
              return 'baseline';
            case 'top':
              return 'top';
            case 'center':
              return 'middle';
            case 'bottom':
              return 'bottom';
          }
          return n;
        },
      },
      {
        key: 'addSize',
        value: function (e, n) {
          return e == null ? n : n == null ? e : 'calc('.concat(e, ' + ').concat(n, ')');
        },
      },
      {
        key: 'classNameOftblLook',
        value: function (e) {
          var n = O.hexAttr(e, 'val', 0),
            a = '';
          return (
            (O.boolAttr(e, 'firstRow') || 32 & n) && (a += ' first-row'),
            (O.boolAttr(e, 'lastRow') || 64 & n) && (a += ' last-row'),
            (O.boolAttr(e, 'firstColumn') || 128 & n) && (a += ' first-col'),
            (O.boolAttr(e, 'lastColumn') || 256 & n) && (a += ' last-col'),
            (O.boolAttr(e, 'noHBand') || 512 & n) && (a += ' no-hband'),
            (O.boolAttr(e, 'noVBand') || 1024 & n) && (a += ' no-vband'),
            a.trim()
          );
        },
      },
    ]);
  })(),
  Bv = { pos: 0, leader: 'none', style: 'left' };
function fw(r, t, e) {
  var n = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : 0.75,
    a = r.closest('p'),
    i = r.getBoundingClientRect(),
    o = a.getBoundingClientRect(),
    s = getComputedStyle(a),
    u =
      t?.length > 0
        ? t
            .map(function (P) {
              return { pos: Dv(P.position), leader: P.leader, style: P.style };
            })
            .sort(function (P, x) {
              return P.pos - x.pos;
            })
        : [Bv],
    l = u[u.length - 1],
    c = o.width * n,
    h = Dv(e),
    d = l.pos + h;
  if (d < c) for (; d < c && u.length < 50; d += h) u.push(nr(nr({}, Bv), {}, { pos: d }));
  var f = parseFloat(s.marginLeft),
    p = o.left + f,
    v = (i.left - p) * n,
    y = u.find(function (P) {
      return P.style != 'clear' && P.pos > v;
    });
  if (y != null) {
    var E = 1;
    if (y.style == 'right' || y.style == 'center') {
      var _ = Array.from(a.querySelectorAll('.'.concat(r.className))),
        g = _.indexOf(r) + 1,
        b = document.createRange();
      b.setStart(r, 1), g < _.length ? b.setEndBefore(_[g]) : b.setEndAfter(a);
      var A = y.style == 'center' ? 0.5 : 1,
        w = b.getBoundingClientRect(),
        T = w.left + A * w.width - (o.left - f);
      E = y.pos - T * n;
    } else E = y.pos - v;
    switch (
      ((r.innerHTML = '&nbsp;'),
      (r.style.textDecoration = 'inherit'),
      (r.style.wordSpacing = ''.concat(E.toFixed(0), 'pt')),
      y.leader)
    ) {
      case 'dot':
      case 'middleDot':
        (r.style.textDecoration = 'underline'), (r.style.textDecorationStyle = 'dotted');
        break;
      case 'hyphen':
      case 'heavy':
      case 'underscore':
        r.style.textDecoration = 'underline';
    }
  }
}
function Dv(r) {
  return parseFloat(r);
}
var hw = 'http://www.w3.org/2000/svg',
  ke = 'http://www.w3.org/1998/Math/MathML',
  dw = (function () {
    function r(t) {
      be(this, r),
        (this.htmlDocument = t),
        (this.className = 'docx'),
        (this.styleMap = {}),
        (this.currentPart = null),
        (this.tableVerticalMerges = []),
        (this.currentVerticalMerge = null),
        (this.tableCellPositions = []),
        (this.currentCellPosition = null),
        (this.footnoteMap = {}),
        (this.endnoteMap = {}),
        (this.currentEndnoteIds = []),
        (this.usedHederFooterParts = []),
        (this.currentTabs = []),
        (this.tabsTimeout = 0),
        (this.commentMap = {}),
        (this.tasks = []),
        (this.postRenderTasks = []),
        (this.createElement = gt);
    }
    return _e(r, [
      {
        key: 'render',
        value: function (e, n) {
          var a,
            i = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : null,
            o = arguments.length > 3 ? arguments[3] : void 0;
          (this.document = e),
            (this.options = o),
            (this.className = o.className),
            (this.rootSelector = o.inWrapper ? '.'.concat(this.className, '-wrapper') : ':root'),
            (this.styleMap = null),
            (this.tasks = []),
            this.options.renderComments && globalThis.Highlight && (this.commentHighlight = new Highlight()),
            Lv((i = i || n)),
            Lv(n),
            en(i, 'docxjs library predefined styles'),
            i.appendChild(this.renderDefaultStyle()),
            e.themePart && (en(i, 'docxjs document theme values'), this.renderTheme(e.themePart, i)),
            e.stylesPart != null &&
              ((this.styleMap = this.processStyles(e.stylesPart.styles)),
              en(i, 'docxjs document styles'),
              i.appendChild(this.renderStyles(e.stylesPart.styles))),
            e.numberingPart &&
              (this.prodessNumberings(e.numberingPart.domNumberings),
              en(i, 'docxjs document numbering styles'),
              i.appendChild(this.renderNumbering(e.numberingPart.domNumberings, i))),
            e.footnotesPart &&
              (this.footnoteMap = ut(e.footnotesPart.notes, function (u) {
                return u.id;
              })),
            e.endnotesPart &&
              (this.endnoteMap = ut(e.endnotesPart.notes, function (u) {
                return u.id;
              })),
            e.settingsPart &&
              (this.defaultTabSize =
                (a = e.settingsPart.settings) === null || a === void 0 ? void 0 : a.defaultTabStop),
            !o.ignoreFonts && e.fontTablePart && this.renderFontTable(e.fontTablePart, i);
          var s = this.renderSections(e.documentPart.body);
          this.options.inWrapper ? n.appendChild(this.renderWrapper(s)) : Ls(n, s),
            this.commentHighlight &&
              o.renderComments &&
              CSS.highlights.set(''.concat(this.className, '-comments'), this.commentHighlight),
            this.refreshTabStops(),
            this.postRenderTasks.forEach(function (u) {
              return u();
            });
        },
      },
      {
        key: 'renderTheme',
        value: function (e, n) {
          var a,
            i,
            o = {},
            s = (a = e.theme) === null || a === void 0 ? void 0 : a.fontScheme;
          s &&
            (s.majorFont && (o['--docx-majorHAnsi-font'] = s.majorFont.latinTypeface),
            s.minorFont && (o['--docx-minorHAnsi-font'] = s.minorFont.latinTypeface));
          var u = (i = e.theme) === null || i === void 0 ? void 0 : i.colorScheme;
          if (u)
            for (var l = 0, c = Object.entries(u.colors); l < c.length; l++) {
              var h = ct(c[l], 2),
                d = h[0],
                f = h[1];
              o['--docx-'.concat(d, '-color')] = '#'.concat(f);
            }
          var p = this.styleToString('.'.concat(this.className), o);
          n.appendChild(Ot(p));
        },
      },
      {
        key: 'renderFontTable',
        value: function (e, n) {
          var a = this,
            i = pe(e.fonts),
            o;
          try {
            var s = function () {
              var l = o.value,
                c = pe(l.embedFontRefs),
                h;
              try {
                var d = function () {
                  var p = h.value;
                  a.tasks.push(
                    a.document.loadFont(p.id, p.key).then(function (v) {
                      var y = { 'font-family': l.name, src: 'url('.concat(v, ')') };
                      (p.type != 'bold' && p.type != 'boldItalic') || (y['font-weight'] = 'bold'),
                        (p.type != 'italic' && p.type != 'boldItalic') || (y['font-style'] = 'italic'),
                        en(n, 'docxjs '.concat(l.name, ' font'));
                      var E = a.styleToString('@font-face', y);
                      n.appendChild(Ot(E)), a.refreshTabStops();
                    })
                  );
                };
                for (c.s(); !(h = c.n()).done; ) d();
              } catch (f) {
                c.e(f);
              } finally {
                c.f();
              }
            };
            for (i.s(); !(o = i.n()).done; ) s();
          } catch (u) {
            i.e(u);
          } finally {
            i.f();
          }
        },
      },
      {
        key: 'processStyleName',
        value: function (e) {
          return e
            ? ''.concat(this.className, '_').concat(
                (function (n) {
                  return n?.replace(/[ .]+/g, '-').replace(/[&]+/g, 'and').toLowerCase();
                })(e)
              )
            : this.className;
        },
      },
      {
        key: 'processStyles',
        value: function (e) {
          var n = this,
            a = ut(
              e.filter(function (v) {
                return v.id != null;
              }),
              function (v) {
                return v.id;
              }
            ),
            i = pe(
              e.filter(function (v) {
                return v.basedOn;
              })
            ),
            o;
          try {
            for (i.s(); !(o = i.n()).done; ) {
              var s = o.value,
                u = a[s.basedOn];
              if (u) {
                (s.paragraphProps = na(s.paragraphProps, u.paragraphProps)), (s.runProps = na(s.runProps, u.runProps));
                var l = pe(u.styles),
                  c;
                try {
                  var h = function () {
                    var y = c.value,
                      E = s.styles.find(function (_) {
                        return _.target == y.target;
                      });
                    E
                      ? n.copyStyleProperties(y.values, E.values)
                      : s.styles.push(nr(nr({}, y), {}, { values: nr({}, y.values) }));
                  };
                  for (l.s(); !(c = l.n()).done; ) h();
                } catch (v) {
                  l.e(v);
                } finally {
                  l.f();
                }
              } else this.options.debug && console.warn("Can't find base style ".concat(s.basedOn));
            }
          } catch (v) {
            i.e(v);
          } finally {
            i.f();
          }
          var d = pe(e),
            f;
          try {
            for (d.s(); !(f = d.n()).done; ) {
              var p = f.value;
              p.cssName = this.processStyleName(p.id);
            }
          } catch (v) {
            d.e(v);
          } finally {
            d.f();
          }
          return a;
        },
      },
      {
        key: 'prodessNumberings',
        value: function (e) {
          var n = pe(
              e.filter(function (u) {
                return u.pStyleName;
              })
            ),
            a;
          try {
            for (n.s(); !(a = n.n()).done; ) {
              var i,
                o = a.value,
                s = this.findStyle(o.pStyleName);
              !(s == null || (i = s.paragraphProps) === null || i === void 0) &&
                i.numbering &&
                (s.paragraphProps.numbering.level = o.level);
            }
          } catch (u) {
            n.e(u);
          } finally {
            n.f();
          }
        },
      },
      {
        key: 'processElement',
        value: function (e) {
          if (e.children) {
            var n = pe(e.children),
              a;
            try {
              for (n.s(); !(a = n.n()).done; ) {
                var i = a.value;
                (i.parent = e), i.type == F.Table ? this.processTable(i) : this.processElement(i);
              }
            } catch (o) {
              n.e(o);
            } finally {
              n.f();
            }
          }
        },
      },
      {
        key: 'processTable',
        value: function (e) {
          var n = pe(e.children),
            a;
          try {
            for (n.s(); !(a = n.n()).done; ) {
              var i = a.value,
                o = pe(i.children),
                s;
              try {
                for (o.s(); !(s = o.n()).done; ) {
                  var u = s.value;
                  (u.cssStyle = this.copyStyleProperties(e.cellStyle, u.cssStyle, [
                    'border-left',
                    'border-right',
                    'border-top',
                    'border-bottom',
                    'padding-left',
                    'padding-right',
                    'padding-top',
                    'padding-bottom',
                  ])),
                    this.processElement(u);
                }
              } catch (l) {
                o.e(l);
              } finally {
                o.f();
              }
            }
          } catch (l) {
            n.e(l);
          } finally {
            n.f();
          }
        },
      },
      {
        key: 'copyStyleProperties',
        value: function (e, n) {
          var a = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : null;
          if (!e) return n;
          var i = pe((n == null && (n = {}), a == null && (a = Object.getOwnPropertyNames(e)), a)),
            o;
          try {
            for (i.s(); !(o = i.n()).done; ) {
              var s = o.value;
              e.hasOwnProperty(s) && !n.hasOwnProperty(s) && (n[s] = e[s]);
            }
          } catch (u) {
            i.e(u);
          } finally {
            i.f();
          }
          return n;
        },
      },
      {
        key: 'createPageElement',
        value: function (e, n) {
          var a = this.createElement('section', { className: e });
          return (
            n &&
              (n.pageMargins &&
                ((a.style.paddingLeft = n.pageMargins.left),
                (a.style.paddingRight = n.pageMargins.right),
                (a.style.paddingTop = n.pageMargins.top),
                (a.style.paddingBottom = n.pageMargins.bottom)),
              n.pageSize &&
                (this.options.ignoreWidth || (a.style.width = n.pageSize.width),
                this.options.ignoreHeight || (a.style.minHeight = n.pageSize.height))),
            a
          );
        },
      },
      {
        key: 'createSectionContent',
        value: function (e) {
          var n = this.createElement('article');
          return (
            e.columns &&
              e.columns.numberOfColumns &&
              ((n.style.columnCount = ''.concat(e.columns.numberOfColumns)),
              (n.style.columnGap = e.columns.space),
              e.columns.separator && (n.style.columnRule = '1px solid black')),
            n
          );
        },
      },
      {
        key: 'renderSections',
        value: function (e) {
          var n = [];
          this.processElement(e);
          for (
            var a = this.splitBySection(e.children, e.props),
              i = this.groupByPageBreaks(a),
              o = null,
              s = 0,
              u = i.length;
            s < u;
            s++
          ) {
            this.currentFootnoteIds = [];
            var l = i[s][0].sectProps,
              c = this.createPageElement(this.className, l);
            this.renderStyleValues(e.cssStyle, c),
              this.options.renderHeaders && this.renderHeaderFooter(l.headerRefs, l, n.length, o != l, c);
            var h = pe(i[s]),
              d;
            try {
              for (h.s(); !(d = h.n()).done; ) {
                var f = d.value,
                  p = this.createSectionContent(f.sectProps);
                this.renderElements(f.elements, p), c.appendChild(p), (l = f.sectProps);
              }
            } catch (v) {
              h.e(v);
            } finally {
              h.f();
            }
            this.options.renderFootnotes && this.renderNotes(this.currentFootnoteIds, this.footnoteMap, c),
              this.options.renderEndnotes && s == u - 1 && this.renderNotes(this.currentEndnoteIds, this.endnoteMap, c),
              this.options.renderFooters && this.renderHeaderFooter(l.footerRefs, l, n.length, o != l, c),
              n.push(c),
              (o = l);
          }
          return n;
        },
      },
      {
        key: 'renderHeaderFooter',
        value: function (e, n, a, i, o) {
          if (e) {
            var s,
              u,
              l =
                (s =
                  (u =
                    n.titlePage && i
                      ? e.find(function (p) {
                          return p.type == 'first';
                        })
                      : null) !== null && u !== void 0
                    ? u
                    : a % 2 == 1
                    ? e.find(function (p) {
                        return p.type == 'even';
                      })
                    : null) !== null && s !== void 0
                  ? s
                  : e.find(function (p) {
                      return p.type == 'default';
                    }),
              c = l && this.document.findPartByRelId(l.id, this.document.documentPart);
            if (c) {
              (this.currentPart = c),
                this.usedHederFooterParts.includes(c.path) ||
                  (this.processElement(c.rootElement), this.usedHederFooterParts.push(c.path));
              var h = this.renderElements([c.rootElement], o),
                d = ct(h, 1),
                f = d[0];
              n != null &&
                n.pageMargins &&
                (c.rootElement.type === F.Header
                  ? ((f.style.marginTop = 'calc('.concat(n.pageMargins.header, ' - ').concat(n.pageMargins.top, ')')),
                    (f.style.minHeight = 'calc('.concat(n.pageMargins.top, ' - ').concat(n.pageMargins.header, ')')))
                  : c.rootElement.type === F.Footer &&
                    ((f.style.marginBottom = 'calc('
                      .concat(n.pageMargins.footer, ' - ')
                      .concat(n.pageMargins.bottom, ')')),
                    (f.style.minHeight = 'calc('
                      .concat(n.pageMargins.bottom, ' - ')
                      .concat(n.pageMargins.footer, ')')))),
                (this.currentPart = null);
            }
          }
        },
      },
      {
        key: 'isPageBreakElement',
        value: function (e) {
          return (
            e.type == F.Break &&
            (e.break == 'lastRenderedPageBreak' ? !this.options.ignoreLastRenderedPageBreak : e.break == 'page')
          );
        },
      },
      {
        key: 'isPageBreakSection',
        value: function (e, n) {
          var a, i, o, s, u, l;
          return (
            !!e &&
            !!n &&
            (((a = e.pageSize) === null || a === void 0 ? void 0 : a.orientation) !=
              ((i = n.pageSize) === null || i === void 0 ? void 0 : i.orientation) ||
              ((o = e.pageSize) === null || o === void 0 ? void 0 : o.width) !=
                ((s = n.pageSize) === null || s === void 0 ? void 0 : s.width) ||
              ((u = e.pageSize) === null || u === void 0 ? void 0 : u.height) !=
                ((l = n.pageSize) === null || l === void 0 ? void 0 : l.height))
          );
        },
      },
      {
        key: 'splitBySection',
        value: function (e, n) {
          var a = this,
            i = { sectProps: null, elements: [], pageBreak: !1 },
            o = [i],
            s = pe(e),
            u;
          try {
            for (s.s(); !(u = s.n()).done; ) {
              var l = u.value;
              if (l.type == F.Paragraph) {
                var c,
                  h = this.findStyle(l.styleName);
                !(h == null || (c = h.paragraphProps) === null || c === void 0) &&
                  c.pageBreakBefore &&
                  ((i.sectProps = f),
                  (i.pageBreak = !0),
                  (i = { sectProps: null, elements: [], pageBreak: !1 }),
                  o.push(i));
              }
              if ((i.elements.push(l), l.type == F.Paragraph)) {
                var d = l,
                  f = d.sectionProps,
                  p = -1,
                  v = -1;
                if (
                  (this.options.breakPages &&
                    d.children &&
                    (p = d.children.findIndex(function (x) {
                      var C, q;
                      return (
                        (v =
                          (C =
                            (q = x.children) === null || q === void 0
                              ? void 0
                              : q.findIndex(a.isPageBreakElement.bind(a))) !== null && C !== void 0
                            ? C
                            : -1) != -1
                      );
                    })),
                  (f || p != -1) &&
                    ((i.sectProps = f),
                    (i.pageBreak = p != -1),
                    (i = { sectProps: null, elements: [], pageBreak: !1 }),
                    o.push(i)),
                  p != -1)
                ) {
                  var y = d.children[p],
                    E = v < y.children.length - 1;
                  if (p < d.children.length - 1 || E) {
                    var _ = l.children,
                      g = nr(nr({}, l), {}, { children: _.slice(p) });
                    if (((l.children = _.slice(0, p)), i.elements.push(g), E)) {
                      var b = y.children,
                        A = nr(nr({}, y), {}, { children: b.slice(0, v) });
                      l.children.push(A), (y.children = b.slice(v));
                    }
                  }
                }
              }
            }
          } catch (x) {
            s.e(x);
          } finally {
            s.f();
          }
          for (var w = null, T = o.length - 1; T >= 0; T--) {
            var P;
            o[T].sectProps == null ? (o[T].sectProps = (P = w) !== null && P !== void 0 ? P : n) : (w = o[T].sectProps);
          }
          return o;
        },
      },
      {
        key: 'groupByPageBreaks',
        value: function (e) {
          var n,
            a = [],
            i = [a],
            o = pe(e),
            s;
          try {
            for (o.s(); !(s = o.n()).done; ) {
              var u = s.value;
              a.push(u),
                (this.options.ignoreLastRenderedPageBreak || u.pageBreak || this.isPageBreakSection(n, u.sectProps)) &&
                  i.push((a = [])),
                (n = u.sectProps);
            }
          } catch (l) {
            o.e(l);
          } finally {
            o.f();
          }
          return i.filter(function (l) {
            return l.length > 0;
          });
        },
      },
      {
        key: 'renderWrapper',
        value: function (e) {
          return this.createElement('div', { className: ''.concat(this.className, '-wrapper') }, e);
        },
      },
      {
        key: 'renderDefaultStyle',
        value: function () {
          var e = this.className,
            n = `
.`
              .concat(
                e,
                `-wrapper { background: gray; padding: 30px; padding-bottom: 0px; display: flex; flex-flow: column; align-items: center; } 
.`
              )
              .concat(e, '-wrapper>section.')
              .concat(
                e,
                ` { background: white; box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); margin-bottom: 30px; }
.`
              )
              .concat(
                e,
                ` { color: black; hyphens: auto; text-underline-position: from-font; }
section.`
              )
              .concat(
                e,
                ` { box-sizing: border-box; display: flex; flex-flow: column nowrap; position: relative; overflow: hidden; }
section.`
              )
              .concat(
                e,
                `>article { margin-bottom: auto; z-index: 1; }
section.`
              )
              .concat(
                e,
                `>footer { z-index: 1; }
.`
              )
              .concat(
                e,
                ` table { border-collapse: collapse; }
.`
              )
              .concat(e, ' table td, .')
              .concat(
                e,
                ` table th { vertical-align: top; }
.`
              )
              .concat(
                e,
                ` p { margin: 0pt; min-height: 1em; }
.`
              )
              .concat(
                e,
                ` span { white-space: pre-wrap; overflow-wrap: break-word; }
.`
              )
              .concat(
                e,
                ` a { color: inherit; text-decoration: inherit; }
.`
              )
              .concat(
                e,
                ` svg { fill: transparent; }
`
              );
          return (
            this.options.renderComments &&
              (n += `
.`
                .concat(
                  e,
                  `-comment-ref { cursor: default; }
.`
                )
                .concat(
                  e,
                  `-comment-popover { display: none; z-index: 1000; padding: 0.5rem; background: white; position: absolute; box-shadow: 0 0 0.25rem rgba(0, 0, 0, 0.25); width: 30ch; }
.`
                )
                .concat(e, '-comment-ref:hover~.')
                .concat(
                  e,
                  `-comment-popover { display: block; }
.`
                )
                .concat(e, '-comment-author,.')
                .concat(
                  e,
                  `-comment-date { font-size: 0.875rem; color: #888; }
`
                )),
            Ot(n)
          );
        },
      },
      {
        key: 'renderNumbering',
        value: function (e, n) {
          var a = this,
            i = '',
            o = [],
            s = pe(e),
            u;
          try {
            var l = function () {
                if (((c = u.value), (h = 'p.'.concat(a.numberingClass(c.id, c.level))), (d = 'none'), c.bullet)) {
                  var p = '--'.concat(a.className, '-').concat(c.bullet.src).toLowerCase();
                  (i += a.styleToString(
                    ''.concat(h, ':before'),
                    { content: "' '", display: 'inline-block', background: 'var('.concat(p, ')') },
                    c.bullet.style
                  )),
                    a.tasks.push(
                      a.document.loadNumberingImage(c.bullet.src).then(function (E) {
                        var _ = ''.concat(a.rootSelector, ' { ').concat(p, ': url(').concat(E, ') }');
                        n.appendChild(Ot(_));
                      })
                    );
                } else if (c.levelText) {
                  var v = a.numberingCounter(c.id, c.level),
                    y = v + ' ' + (c.start - 1);
                  c.level > 0 &&
                    (i += a.styleToString('p.'.concat(a.numberingClass(c.id, c.level - 1)), { 'counter-reset': y })),
                    o.push(y),
                    (i += a.styleToString(
                      ''.concat(h, ':before'),
                      nr(
                        {
                          content: a.levelTextToContent(c.levelText, c.suff, c.id, a.numFormatToCssValue(c.format)),
                          'counter-increment': v,
                        },
                        c.rStyle
                      )
                    ));
                } else d = a.numFormatToCssValue(c.format);
                i += a.styleToString(
                  h,
                  nr({ display: 'list-item', 'list-style-position': 'inside', 'list-style-type': d }, c.pStyle)
                );
              },
              c,
              h,
              d;
            for (s.s(); !(u = s.n()).done; ) l();
          } catch (f) {
            s.e(f);
          } finally {
            s.f();
          }
          return o.length > 0 && (i += this.styleToString(this.rootSelector, { 'counter-reset': o.join(' ') })), Ot(i);
        },
      },
      {
        key: 'renderStyles',
        value: function (e) {
          var n = '',
            a = this.styleMap,
            i = ut(
              e.filter(function (y) {
                return y.isDefault;
              }),
              function (y) {
                return y.target;
              }
            ),
            o = pe(e),
            s;
          try {
            for (o.s(); !(s = o.n()).done; ) {
              var u = s.value,
                l = u.styles;
              if (u.linked) {
                var c = u.linked && a[u.linked];
                c
                  ? (l = l.concat(c.styles))
                  : this.options.debug && console.warn("Can't find linked style ".concat(u.linked));
              }
              var h = pe(l),
                d;
              try {
                for (h.s(); !(d = h.n()).done; ) {
                  var f,
                    p = d.value,
                    v = ''.concat((f = u.target) !== null && f !== void 0 ? f : '', '.').concat(u.cssName);
                  u.target != p.target && (v += ' '.concat(p.target)),
                    i[u.target] == u && (v = '.'.concat(this.className, ' ').concat(u.target, ', ') + v),
                    (n += this.styleToString(v, p.values));
                }
              } catch (y) {
                h.e(y);
              } finally {
                h.f();
              }
            }
          } catch (y) {
            o.e(y);
          } finally {
            o.f();
          }
          return Ot(n);
        },
      },
      {
        key: 'renderNotes',
        value: function (e, n, a) {
          var i = e
            .map(function (s) {
              return n[s];
            })
            .filter(function (s) {
              return s;
            });
          if (i.length > 0) {
            var o = this.createElement('ol', null, this.renderElements(i));
            a.appendChild(o);
          }
        },
      },
      {
        key: 'renderElement',
        value: function (e) {
          switch (e.type) {
            case F.Paragraph:
              return this.renderParagraph(e);
            case F.BookmarkStart:
              return this.renderBookmarkStart(e);
            case F.BookmarkEnd:
              return null;
            case F.Run:
              return this.renderRun(e);
            case F.Table:
              return this.renderTable(e);
            case F.Row:
              return this.renderTableRow(e);
            case F.Cell:
              return this.renderTableCell(e);
            case F.Hyperlink:
              return this.renderHyperlink(e);
            case F.SmartTag:
              return this.renderSmartTag(e);
            case F.Drawing:
              return this.renderDrawing(e);
            case F.Image:
              return this.renderImage(e);
            case F.Text:
            case F.Text:
              return this.renderText(e);
            case F.DeletedText:
              return this.renderDeletedText(e);
            case F.Tab:
              return this.renderTab(e);
            case F.Symbol:
              return this.renderSymbol(e);
            case F.Break:
              return this.renderBreak(e);
            case F.Footer:
              return this.renderContainer(e, 'footer');
            case F.Header:
              return this.renderContainer(e, 'header');
            case F.Footnote:
            case F.Endnote:
              return this.renderContainer(e, 'li');
            case F.FootnoteReference:
              return this.renderFootnoteReference(e);
            case F.EndnoteReference:
              return this.renderEndnoteReference(e);
            case F.NoBreakHyphen:
              return this.createElement('wbr');
            case F.VmlPicture:
              return this.renderVmlPicture(e);
            case F.VmlElement:
              return this.renderVmlElement(e);
            case F.MmlMath:
              return this.renderContainerNS(e, ke, 'math', { xmlns: ke });
            case F.MmlMathParagraph:
              return this.renderContainer(e, 'span');
            case F.MmlFraction:
              return this.renderContainerNS(e, ke, 'mfrac');
            case F.MmlBase:
              return this.renderContainerNS(e, ke, e.parent.type == F.MmlMatrixRow ? 'mtd' : 'mrow');
            case F.MmlNumerator:
            case F.MmlDenominator:
            case F.MmlFunction:
            case F.MmlLimit:
            case F.MmlBox:
              return this.renderContainerNS(e, ke, 'mrow');
            case F.MmlGroupChar:
              return this.renderMmlGroupChar(e);
            case F.MmlLimitLower:
              return this.renderContainerNS(e, ke, 'munder');
            case F.MmlMatrix:
              return this.renderContainerNS(e, ke, 'mtable');
            case F.MmlMatrixRow:
              return this.renderContainerNS(e, ke, 'mtr');
            case F.MmlRadical:
              return this.renderMmlRadical(e);
            case F.MmlSuperscript:
              return this.renderContainerNS(e, ke, 'msup');
            case F.MmlSubscript:
              return this.renderContainerNS(e, ke, 'msub');
            case F.MmlDegree:
            case F.MmlSuperArgument:
            case F.MmlSubArgument:
              return this.renderContainerNS(e, ke, 'mn');
            case F.MmlFunctionName:
              return this.renderContainerNS(e, ke, 'ms');
            case F.MmlDelimiter:
              return this.renderMmlDelimiter(e);
            case F.MmlRun:
              return this.renderMmlRun(e);
            case F.MmlNary:
              return this.renderMmlNary(e);
            case F.MmlPreSubSuper:
              return this.renderMmlPreSubSuper(e);
            case F.MmlBar:
              return this.renderMmlBar(e);
            case F.MmlEquationArray:
              return this.renderMllList(e);
            case F.Inserted:
              return this.renderInserted(e);
            case F.Deleted:
              return this.renderDeleted(e);
            case F.CommentRangeStart:
              return this.renderCommentRangeStart(e);
            case F.CommentRangeEnd:
              return this.renderCommentRangeEnd(e);
            case F.CommentReference:
              return this.renderCommentReference(e);
          }
          return null;
        },
      },
      {
        key: 'renderChildren',
        value: function (e, n) {
          return this.renderElements(e.children, n);
        },
      },
      {
        key: 'renderElements',
        value: function (e, n) {
          var a = this;
          if (e == null) return null;
          var i = e
            .flatMap(function (o) {
              return a.renderElement(o);
            })
            .filter(function (o) {
              return o != null;
            });
          return n && Ls(n, i), i;
        },
      },
      {
        key: 'renderContainer',
        value: function (e, n, a) {
          return this.createElement(n, a, this.renderChildren(e));
        },
      },
      {
        key: 'renderContainerNS',
        value: function (e, n, a, i) {
          return Be(n, a, i, this.renderChildren(e));
        },
      },
      {
        key: 'renderParagraph',
        value: function (e) {
          var n,
            a,
            i,
            o,
            s = this.createElement('p'),
            u = this.findStyle(e.styleName);
          ((n = e.tabs) !== null && n !== void 0) ||
            (e.tabs = u == null || (a = u.paragraphProps) === null || a === void 0 ? void 0 : a.tabs),
            this.renderClass(e, s),
            this.renderChildren(e, s),
            this.renderStyleValues(e.cssStyle, s),
            this.renderCommonProperties(s.style, e);
          var l =
            (i = e.numbering) !== null && i !== void 0
              ? i
              : u == null || (o = u.paragraphProps) === null || o === void 0
              ? void 0
              : o.numbering;
          return l && s.classList.add(this.numberingClass(l.id, l.level)), s;
        },
      },
      {
        key: 'renderRunProperties',
        value: function (e, n) {
          this.renderCommonProperties(e, n);
        },
      },
      {
        key: 'renderCommonProperties',
        value: function (e, n) {
          n != null && (n.color && (e.color = n.color), n.fontSize && (e['font-size'] = n.fontSize));
        },
      },
      {
        key: 'renderHyperlink',
        value: function (e) {
          var n = this.createElement('a');
          if ((this.renderChildren(e, n), this.renderStyleValues(e.cssStyle, n), e.href)) n.href = e.href;
          else if (e.id) {
            var a = this.document.documentPart.rels.find(function (i) {
              return i.id == e.id && i.targetMode === 'External';
            });
            n.href = a?.target;
          }
          return n;
        },
      },
      {
        key: 'renderSmartTag',
        value: function (e) {
          var n = this.createElement('span');
          return this.renderChildren(e, n), n;
        },
      },
      {
        key: 'renderCommentRangeStart',
        value: function (e) {
          var n;
          if (!this.options.renderComments) return null;
          var a = new Range();
          (n = this.commentHighlight) === null || n === void 0 || n.add(a);
          var i = this.htmlDocument.createComment('start of comment #'.concat(e.id));
          return (
            this.later(function () {
              return a.setStart(i, 0);
            }),
            (this.commentMap[e.id] = a),
            i
          );
        },
      },
      {
        key: 'renderCommentRangeEnd',
        value: function (e) {
          if (!this.options.renderComments) return null;
          var n = this.commentMap[e.id],
            a = this.htmlDocument.createComment('end of comment #'.concat(e.id));
          return (
            this.later(function () {
              return n?.setEnd(a, 0);
            }),
            a
          );
        },
      },
      {
        key: 'renderCommentReference',
        value: function (e) {
          var n;
          if (!this.options.renderComments) return null;
          var a = (n = this.document.commentsPart) === null || n === void 0 ? void 0 : n.commentMap[e.id];
          if (!a) return null;
          var i = new DocumentFragment(),
            o = gt('span', { className: ''.concat(this.className, '-comment-ref') }, ['💬']),
            s = gt('div', { className: ''.concat(this.className, '-comment-popover') });
          return (
            this.renderCommentContent(a, s),
            i.appendChild(
              this.htmlDocument.createComment('comment #'.concat(a.id, ' by ').concat(a.author, ' on ').concat(a.date))
            ),
            i.appendChild(o),
            i.appendChild(s),
            i
          );
        },
      },
      {
        key: 'renderCommentContent',
        value: function (e, n) {
          n.appendChild(gt('div', { className: ''.concat(this.className, '-comment-author') }, [e.author])),
            n.appendChild(
              gt('div', { className: ''.concat(this.className, '-comment-date') }, [new Date(e.date).toLocaleString()])
            ),
            this.renderChildren(e, n);
        },
      },
      {
        key: 'renderDrawing',
        value: function (e) {
          var n = this.createElement('div');
          return (
            (n.style.display = 'inline-block'),
            (n.style.position = 'relative'),
            (n.style.textIndent = '0px'),
            this.renderChildren(e, n),
            this.renderStyleValues(e.cssStyle, n),
            n
          );
        },
      },
      {
        key: 'renderImage',
        value: function (e) {
          var n = this.createElement('img');
          return (
            this.renderStyleValues(e.cssStyle, n),
            this.document &&
              this.tasks.push(
                this.document.loadDocumentImage(e.src, this.currentPart).then(function (a) {
                  n.src = a;
                })
              ),
            n
          );
        },
      },
      {
        key: 'renderText',
        value: function (e) {
          return this.htmlDocument.createTextNode(e.text);
        },
      },
      {
        key: 'renderDeletedText',
        value: function (e) {
          return this.options.renderEndnotes ? this.htmlDocument.createTextNode(e.text) : null;
        },
      },
      {
        key: 'renderBreak',
        value: function (e) {
          return e.break == 'textWrapping' ? this.createElement('br') : null;
        },
      },
      {
        key: 'renderInserted',
        value: function (e) {
          return this.options.renderChanges ? this.renderContainer(e, 'ins') : this.renderChildren(e);
        },
      },
      {
        key: 'renderDeleted',
        value: function (e) {
          return this.options.renderChanges ? this.renderContainer(e, 'del') : null;
        },
      },
      {
        key: 'renderSymbol',
        value: function (e) {
          var n = this.createElement('span');
          return (n.style.fontFamily = e.font), (n.innerHTML = '&#x'.concat(e.char, ';')), n;
        },
      },
      {
        key: 'renderFootnoteReference',
        value: function (e) {
          var n = this.createElement('sup');
          return this.currentFootnoteIds.push(e.id), (n.textContent = ''.concat(this.currentFootnoteIds.length)), n;
        },
      },
      {
        key: 'renderEndnoteReference',
        value: function (e) {
          var n = this.createElement('sup');
          return this.currentEndnoteIds.push(e.id), (n.textContent = ''.concat(this.currentEndnoteIds.length)), n;
        },
      },
      {
        key: 'renderTab',
        value: function (e) {
          var n = this.createElement('span');
          if (((n.innerHTML = '&emsp;'), this.options.experimental)) {
            var a;
            n.className = this.tabStopClass();
            var i =
              (a = (function (o, s) {
                for (var u = o.parent; u != null && u.type != s; ) u = u.parent;
                return u;
              })(e, F.Paragraph)) === null || a === void 0
                ? void 0
                : a.tabs;
            this.currentTabs.push({ stops: i, span: n });
          }
          return n;
        },
      },
      {
        key: 'renderBookmarkStart',
        value: function (e) {
          var n = this.createElement('span');
          return (n.id = e.name), n;
        },
      },
      {
        key: 'renderRun',
        value: function (e) {
          if (e.fieldRun) return null;
          var n = this.createElement('span');
          if ((e.id && (n.id = e.id), this.renderClass(e, n), this.renderStyleValues(e.cssStyle, n), e.verticalAlign)) {
            var a = this.createElement(e.verticalAlign);
            this.renderChildren(e, a), n.appendChild(a);
          } else this.renderChildren(e, n);
          return n;
        },
      },
      {
        key: 'renderTable',
        value: function (e) {
          var n = this.createElement('table');
          return (
            this.tableCellPositions.push(this.currentCellPosition),
            this.tableVerticalMerges.push(this.currentVerticalMerge),
            (this.currentVerticalMerge = {}),
            (this.currentCellPosition = { col: 0, row: 0 }),
            e.columns && n.appendChild(this.renderTableColumns(e.columns)),
            this.renderClass(e, n),
            this.renderChildren(e, n),
            this.renderStyleValues(e.cssStyle, n),
            (this.currentVerticalMerge = this.tableVerticalMerges.pop()),
            (this.currentCellPosition = this.tableCellPositions.pop()),
            n
          );
        },
      },
      {
        key: 'renderTableColumns',
        value: function (e) {
          var n = this.createElement('colgroup'),
            a = pe(e),
            i;
          try {
            for (a.s(); !(i = a.n()).done; ) {
              var o = i.value,
                s = this.createElement('col');
              o.width && (s.style.width = o.width), n.appendChild(s);
            }
          } catch (u) {
            a.e(u);
          } finally {
            a.f();
          }
          return n;
        },
      },
      {
        key: 'renderTableRow',
        value: function (e) {
          var n = this.createElement('tr');
          return (
            (this.currentCellPosition.col = 0),
            this.renderClass(e, n),
            this.renderChildren(e, n),
            this.renderStyleValues(e.cssStyle, n),
            this.currentCellPosition.row++,
            n
          );
        },
      },
      {
        key: 'renderTableCell',
        value: function (e) {
          var n = this.createElement('td'),
            a = this.currentCellPosition.col;
          return (
            e.verticalMerge
              ? e.verticalMerge == 'restart'
                ? ((this.currentVerticalMerge[a] = n), (n.rowSpan = 1))
                : this.currentVerticalMerge[a] &&
                  ((this.currentVerticalMerge[a].rowSpan += 1), (n.style.display = 'none'))
              : (this.currentVerticalMerge[a] = null),
            this.renderClass(e, n),
            this.renderChildren(e, n),
            this.renderStyleValues(e.cssStyle, n),
            e.span && (n.colSpan = e.span),
            (this.currentCellPosition.col += n.colSpan),
            n
          );
        },
      },
      {
        key: 'renderVmlPicture',
        value: function (e) {
          var n = gt('div');
          return this.renderChildren(e, n), n;
        },
      },
      {
        key: 'renderVmlElement',
        value: function (e) {
          var n,
            a,
            i = jv('svg');
          i.setAttribute('style', e.cssStyleText);
          var o = this.renderVmlChildElement(e);
          return (
            (n = e.imageHref) !== null &&
              n !== void 0 &&
              n.id &&
              this.tasks.push(
                (a = this.document) === null || a === void 0
                  ? void 0
                  : a.loadDocumentImage(e.imageHref.id, this.currentPart).then(function (s) {
                      return o.setAttribute('href', s);
                    })
              ),
            i.appendChild(o),
            requestAnimationFrame(function () {
              var s = i.firstElementChild.getBBox();
              i.setAttribute('width', ''.concat(Math.ceil(s.x + s.width))),
                i.setAttribute('height', ''.concat(Math.ceil(s.y + s.height)));
            }),
            i
          );
        },
      },
      {
        key: 'renderVmlChildElement',
        value: function (e) {
          var n = jv(e.tagName);
          Object.entries(e.attrs).forEach(function (s) {
            var u = ct(s, 2),
              l = u[0],
              c = u[1];
            return n.setAttribute(l, c);
          });
          var a = pe(e.children),
            i;
          try {
            for (a.s(); !(i = a.n()).done; ) {
              var o = i.value;
              o.type == F.VmlElement
                ? n.appendChild(this.renderVmlChildElement(o))
                : n.appendChild.apply(n, wt(Jt(this.renderElement(o))));
            }
          } catch (s) {
            a.e(s);
          } finally {
            a.f();
          }
          return n;
        },
      },
      {
        key: 'renderMmlRadical',
        value: function (e) {
          var n,
            a = e.children.find(function (o) {
              return o.type == F.MmlBase;
            });
          if ((n = e.props) !== null && n !== void 0 && n.hideDegree)
            return Be(ke, 'msqrt', null, this.renderElements([a]));
          var i = e.children.find(function (o) {
            return o.type == F.MmlDegree;
          });
          return Be(ke, 'mroot', null, this.renderElements([a, i]));
        },
      },
      {
        key: 'renderMmlDelimiter',
        value: function (e) {
          var n,
            a,
            i = [];
          return (
            i.push(Be(ke, 'mo', null, [(n = e.props.beginChar) !== null && n !== void 0 ? n : '('])),
            i.push.apply(i, wt(this.renderElements(e.children))),
            i.push(Be(ke, 'mo', null, [(a = e.props.endChar) !== null && a !== void 0 ? a : ')'])),
            Be(ke, 'mrow', null, i)
          );
        },
      },
      {
        key: 'renderMmlNary',
        value: function (e) {
          var n,
            a,
            i = [],
            o = ut(e.children, function (d) {
              return d.type;
            }),
            s = o[F.MmlSuperArgument],
            u = o[F.MmlSubArgument],
            l = s ? Be(ke, 'mo', null, Jt(this.renderElement(s))) : null,
            c = u ? Be(ke, 'mo', null, Jt(this.renderElement(u))) : null,
            h = Be(ke, 'mo', null, [
              (n = (a = e.props) === null || a === void 0 ? void 0 : a.char) !== null && n !== void 0 ? n : '∫',
            ]);
          return (
            l || c
              ? i.push(Be(ke, 'munderover', null, [h, c, l]))
              : l
              ? i.push(Be(ke, 'mover', null, [h, l]))
              : c
              ? i.push(Be(ke, 'munder', null, [h, c]))
              : i.push(h),
            i.push.apply(i, wt(this.renderElements(o[F.MmlBase].children))),
            Be(ke, 'mrow', null, i)
          );
        },
      },
      {
        key: 'renderMmlPreSubSuper',
        value: function (e) {
          var n = [],
            a = ut(e.children, function (c) {
              return c.type;
            }),
            i = a[F.MmlSuperArgument],
            o = a[F.MmlSubArgument],
            s = i ? Be(ke, 'mo', null, Jt(this.renderElement(i))) : null,
            u = o ? Be(ke, 'mo', null, Jt(this.renderElement(o))) : null,
            l = Be(ke, 'mo', null);
          return (
            n.push(Be(ke, 'msubsup', null, [l, u, s])),
            n.push.apply(n, wt(this.renderElements(a[F.MmlBase].children))),
            Be(ke, 'mrow', null, n)
          );
        },
      },
      {
        key: 'renderMmlGroupChar',
        value: function (e) {
          var n = e.props.verticalJustification === 'bot' ? 'mover' : 'munder',
            a = this.renderContainerNS(e, ke, n);
          return e.props.char && a.appendChild(Be(ke, 'mo', null, [e.props.char])), a;
        },
      },
      {
        key: 'renderMmlBar',
        value: function (e) {
          var n = this.renderContainerNS(e, ke, 'mrow');
          switch (e.props.position) {
            case 'top':
              n.style.textDecoration = 'overline';
              break;
            case 'bottom':
              n.style.textDecoration = 'underline';
          }
          return n;
        },
      },
      {
        key: 'renderMmlRun',
        value: function (e) {
          var n = Be(ke, 'ms');
          return this.renderClass(e, n), this.renderStyleValues(e.cssStyle, n), this.renderChildren(e, n), n;
        },
      },
      {
        key: 'renderMllList',
        value: function (e) {
          var n = Be(ke, 'mtable');
          this.renderClass(e, n), this.renderStyleValues(e.cssStyle, n), this.renderChildren(e);
          var a = pe(this.renderChildren(e)),
            i;
          try {
            for (a.s(); !(i = a.n()).done; ) {
              var o = i.value;
              n.appendChild(Be(ke, 'mtr', null, [Be(ke, 'mtd', null, [o])]));
            }
          } catch (s) {
            a.e(s);
          } finally {
            a.f();
          }
          return n;
        },
      },
      {
        key: 'renderStyleValues',
        value: function (e, n) {
          for (var a in e) a.startsWith('$') ? n.setAttribute(a.slice(1), e[a]) : (n.style[a] = e[a]);
        },
      },
      {
        key: 'renderClass',
        value: function (e, n) {
          e.className && (n.className = e.className),
            e.styleName && n.classList.add(this.processStyleName(e.styleName));
        },
      },
      {
        key: 'findStyle',
        value: function (e) {
          var n;
          return e && ((n = this.styleMap) === null || n === void 0 ? void 0 : n[e]);
        },
      },
      {
        key: 'numberingClass',
        value: function (e, n) {
          return ''.concat(this.className, '-num-').concat(e, '-').concat(n);
        },
      },
      {
        key: 'tabStopClass',
        value: function () {
          return ''.concat(this.className, '-tab-stop');
        },
      },
      {
        key: 'styleToString',
        value: function (e, n) {
          var a = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : null,
            i = ''.concat(
              e,
              ` {\r
`
            );
          for (var o in n)
            o.startsWith('$') ||
              (i += '  '.concat(o, ': ').concat(
                n[o],
                `;\r
`
              ));
          return (
            a && (i += a),
            i +
              `}\r
`
          );
        },
      },
      {
        key: 'numberingCounter',
        value: function (e, n) {
          return ''.concat(this.className, '-num-').concat(e, '-').concat(n);
        },
      },
      {
        key: 'levelTextToContent',
        value: function (e, n, a, i) {
          var o = this,
            s;
          return '"'
            .concat(
              e.replace(/%\d*/g, function (u) {
                var l = parseInt(u.substring(1), 10) - 1;
                return '"counter('.concat(o.numberingCounter(a, l), ', ').concat(i, ')"');
              })
            )
            .concat((s = { tab: '\\9', space: '\\a0' }[n]) !== null && s !== void 0 ? s : '', '"');
        },
      },
      {
        key: 'numFormatToCssValue',
        value: function (e) {
          var n;
          return (n = {
            none: 'none',
            bullet: 'disc',
            decimal: 'decimal',
            lowerLetter: 'lower-alpha',
            upperLetter: 'upper-alpha',
            lowerRoman: 'lower-roman',
            upperRoman: 'upper-roman',
            decimalZero: 'decimal-leading-zero',
            aiueo: 'katakana',
            aiueoFullWidth: 'katakana',
            chineseCounting: 'simp-chinese-informal',
            chineseCountingThousand: 'simp-chinese-informal',
            chineseLegalSimplified: 'simp-chinese-formal',
            chosung: 'hangul-consonant',
            ideographDigital: 'cjk-ideographic',
            ideographTraditional: 'cjk-heavenly-stem',
            ideographLegalTraditional: 'trad-chinese-formal',
            ideographZodiac: 'cjk-earthly-branch',
            iroha: 'katakana-iroha',
            irohaFullWidth: 'katakana-iroha',
            japaneseCounting: 'japanese-informal',
            japaneseDigitalTenThousand: 'cjk-decimal',
            japaneseLegal: 'japanese-formal',
            thaiNumbers: 'thai',
            koreanCounting: 'korean-hangul-formal',
            koreanDigital: 'korean-hangul-formal',
            koreanDigital2: 'korean-hanja-informal',
            hebrew1: 'hebrew',
            hebrew2: 'hebrew',
            hindiNumbers: 'devanagari',
            ganada: 'hangul',
            taiwaneseCounting: 'cjk-ideographic',
            taiwaneseCountingThousand: 'cjk-ideographic',
            taiwaneseDigital: 'cjk-decimal',
          }[e]) !== null && n !== void 0
            ? n
            : e;
        },
      },
      {
        key: 'refreshTabStops',
        value: function () {
          var e = this;
          this.options.experimental &&
            (clearTimeout(this.tabsTimeout),
            (this.tabsTimeout = setTimeout(function () {
              var n = (function () {
                  var s = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : document.body,
                    u = document.createElement('div');
                  (u.style.width = '100pt'), s.appendChild(u);
                  var l = 100 / u.offsetWidth;
                  return s.removeChild(u), l;
                })(),
                a = pe(e.currentTabs),
                i;
              try {
                for (a.s(); !(i = a.n()).done; ) {
                  var o = i.value;
                  fw(o.span, o.stops, e.defaultTabSize, n);
                }
              } catch (s) {
                a.e(s);
              } finally {
                a.f();
              }
            }, 500)));
        },
      },
      {
        key: 'later',
        value: function (e) {
          this.postRenderTasks.push(e);
        },
      },
    ]);
  })();
function gt(r, t, e) {
  return Be(void 0, r, t, e);
}
function jv(r, t, e) {
  return Be(hw, r, t, e);
}
function Be(r, t, e, n) {
  var a = r ? document.createElementNS(r, t) : document.createElement(t);
  return Object.assign(a, e), n && Ls(a, n), a;
}
function Lv(r) {
  r.innerHTML = '';
}
function Ls(r, t) {
  t.forEach(function (e) {
    return r.appendChild(typeof (n = e) == 'string' || n instanceof String ? document.createTextNode(e) : e);
    var n;
  });
}
function Ot(r) {
  return gt('style', { innerHTML: r });
}
function en(r, t) {
  r.appendChild(document.createComment(t));
}
var Uv = {
  ignoreHeight: !1,
  ignoreWidth: !1,
  ignoreFonts: !1,
  breakPages: !0,
  debug: !1,
  experimental: !1,
  className: 'docx',
  inWrapper: !0,
  trimXmlDeclaration: !0,
  ignoreLastRenderedPageBreak: !0,
  renderHeaders: !0,
  renderFooters: !0,
  renderFootnotes: !0,
  renderEndnotes: !0,
  useBase64URL: !1,
  renderChanges: !1,
  renderComments: !1,
};
function pw(r, t, e, n) {
  return Us.apply(this, arguments);
}
function Us() {
  return (
    (Us = Sr(
      Ie().mark(function r(t, e, n, a) {
        var i;
        return Ie().wrap(function (s) {
          for (;;)
            switch ((s.prev = s.next)) {
              case 0:
                return (
                  (s.next = 2),
                  (function (u, l) {
                    var c = nr(nr({}, Uv), l);
                    return Z0.load(u, new lw(c), c);
                  })(t, a)
                );
              case 2:
                return (
                  (i = s.sent),
                  (s.next = 5),
                  (function () {
                    var u = Sr(
                      Ie().mark(function l(c, h, d, f) {
                        var p, v;
                        return Ie().wrap(function (E) {
                          for (;;)
                            switch ((E.prev = E.next)) {
                              case 0:
                                return (
                                  (p = nr(nr({}, Uv), f)),
                                  (v = new dw(window.document)),
                                  E.abrupt('return', (v.render(c, h, d, p), Promise.allSettled(v.tasks)))
                                );
                              case 2:
                              case 'end':
                                return E.stop();
                            }
                        }, l);
                      })
                    );
                    return function (l, c, h, d) {
                      return u.apply(this, arguments);
                    };
                  })()(i, e, n, a)
                );
              case 5:
                return s.abrupt('return', i);
              case 6:
              case 'end':
                return s.stop();
            }
        }, r);
      })
    )),
    Us.apply(this, arguments)
  );
}
var vw = { ignoreLastRenderedPageBreak: !1 },
  rn = {
    getData: function (t) {
      var e = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      return typeof t == 'string'
        ? (function (n, a) {
            return fetch(n, a).then(function (i) {
              return i.status !== 200 ? Promise.reject(i) : i;
            });
          })(t, e)
        : Promise.resolve(t);
    },
    render: function (t, e) {
      var n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
      if (!t) return (e.innerHTML = ''), Promise.resolve();
      var a;
      return (
        t instanceof Blob
          ? (a = t)
          : t instanceof Response
          ? (a = t.blob())
          : t instanceof ArrayBuffer && (a = new Blob([t])),
        pw(a, e, e, nr(nr({}, vw), n))
      );
    },
    getBlob: (function () {
      var r = Sr(
        Ie().mark(function e(n) {
          var a;
          return Ie().wrap(function (o) {
            for (;;)
              switch ((o.prev = o.next)) {
                case 0:
                  if (!(n instanceof Blob)) {
                    o.next = 4;
                    break;
                  }
                  (a = n), (o.next = 11);
                  break;
                case 4:
                  if (!(n instanceof Response)) {
                    o.next = 10;
                    break;
                  }
                  return (o.next = 7), n.blob();
                case 7:
                  (a = o.sent), (o.next = 11);
                  break;
                case 10:
                  n instanceof ArrayBuffer && (a = new Blob([n]));
                case 11:
                  return o.abrupt('return', a);
                case 12:
                case 'end':
                  return o.stop();
              }
          }, e);
        })
      );
      function t(e) {
        return r.apply(this, arguments);
      }
      return t;
    })(),
  };
function mw(r, t) {
  return zs.apply(this, arguments);
}
function zs() {
  return (
    (zs = Sr(
      Ie().mark(function r(t, e) {
        return Ie().wrap(function (a) {
          for (;;)
            switch ((a.prev = a.next)) {
              case 0:
                e &&
                  (e instanceof ArrayBuffer && (e = new Blob([e])),
                  (function (i, o) {
                    var s = document.createElement('a');
                    (s.download = i),
                      (s.style.display = 'none'),
                      (s.href = o),
                      document.body.appendChild(s),
                      s.click(),
                      document.body.removeChild(s);
                  })(t, URL.createObjectURL(e)));
              case 1:
              case 'end':
                return a.stop();
            }
        }, r);
      })
    )),
    zs.apply(this, arguments)
  );
}
var yw = (function () {
    function r(t) {
      var e = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {},
        n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
      be(this, r),
        mt(this, 'container', null),
        mt(this, 'wrapper', null),
        mt(this, 'wrapperMain', null),
        mt(this, 'options', {}),
        mt(this, 'requestOptions', {}),
        mt(this, 'fileData', null),
        (this.container = t),
        (this.options = e),
        (this.requestOptions = n),
        this.createWrapper();
    }
    return _e(r, [
      {
        key: 'createWrapper',
        value: function () {
          (this.wrapper = document.createElement('div')),
            (this.wrapper.className = 'vue-office-docx'),
            (this.wrapperMain = document.createElement('div')),
            (this.wrapperMain.className = 'vue-office-docx-main'),
            this.wrapper.appendChild(this.wrapperMain),
            this.container.appendChild(this.wrapper);
        },
      },
      {
        key: 'setOptions',
        value: function (e) {
          this.options = e;
        },
      },
      {
        key: 'setRequestOptions',
        value: function (e) {
          this.requestOptions = e;
        },
      },
      {
        key: 'preview',
        value: function (e) {
          var n = this;
          return new Promise(function (a, i) {
            rn.getData(e, n.requestOptions)
              .then(
                (function () {
                  var o = Sr(
                    Ie().mark(function s(u) {
                      return Ie().wrap(function (c) {
                        for (;;)
                          switch ((c.prev = c.next)) {
                            case 0:
                              return (c.next = 2), rn.getBlob(u);
                            case 2:
                              (n.fileData = c.sent),
                                rn
                                  .render(n.fileData, n.wrapperMain, n.options)
                                  .then(function () {
                                    a();
                                  })
                                  .catch(function (h) {
                                    rn.render('', n.wrapperMain, n.options), i(h);
                                  });
                            case 4:
                            case 'end':
                              return c.stop();
                          }
                      }, s);
                    })
                  );
                  return function (s) {
                    return o.apply(this, arguments);
                  };
                })()
              )
              .catch(function (o) {
                rn.render('', n.wrapperMain, n.options), i(o);
              });
          });
        },
      },
      {
        key: 'save',
        value: function (e) {
          mw(e || 'js-preview-docx-'.concat(new Date().getTime(), '.docx'), this.fileData);
        },
      },
      {
        key: 'destroy',
        value: function () {
          this.container.removeChild(this.wrapper),
            (this.container = null),
            (this.wrapper = null),
            (this.wrapperMain = null),
            (this.options = null),
            (this.requestOptions = null);
        },
      },
    ]);
  })(),
  gw = {
    init: function (t, e, n) {
      return new yw(t, e, n);
    },
  };
Object.assign(window, { jsPreviewDocx: gw });
