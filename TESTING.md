# 单元测试说明 — Product 读取 / 搜索 / 支付

本文档说明本次为 **Product 读取、搜索、支付** 相关模块补充的单元测试：测试范围、Mock 策略、覆盖率结果，以及测试过程中发现的源码问题。

---

## 1. 如何运行

```bash
npm run test            # 后端 + 前端全部
npm run test:backend    # 仅后端（controllers/*.test.js）
npm run test:frontend   # 仅前端（client/src 下的页面与 context）
```

底层都是 `node --experimental-vm-modules node_modules/jest/bin/jest.js --config <config>`，`--experimental-vm-modules` 是因为项目源码使用 ESM 语法。

只跑单个文件：

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js \
  --config jest.backend.config.js --coverage=false productController
```

---

## 2. 测试文件清单

| 测试文件 | 被测对象 | 用例数 |
|---|---|---|
| `controllers/productController.test.js` | 11 个 Product controller | 33 |
| `client/src/pages/ProductDetails.test.js` | 商品详情页 | 7 |
| `client/src/pages/CategoryProduct.test.js` | 分类商品列表页 | 6 |
| `client/src/pages/CartPage.test.js` | 购物车 / 结账页 | 21 |
| `client/src/context/cart.test.js` | 购物车 Context | 5 |
| **合计（本次新增）** | | **72** |

加上原有的 `pages/Auth/Login.test.js`、`Register.test.js`（7 个），全项目共 79 个用例，全部通过。

---

## 3. 配置改动

### 3.1 `babel.config.cjs` — JSX 改用 automatic runtime

```js
['@babel/preset-react', { runtime: 'automatic' }]
```

**原因**：`client/src/context/cart.js` 只写了 `import { useState, useContext, createContext, useEffect } from "react"`，没有 `import React`，但文件里使用了 JSX。

- CRA（`react-scripts`）默认用 automatic runtime，JSX 会被编译成 `_jsx(...)` 并自动注入 import，所以开发时能跑。
- 本仓库的 Jest 走根目录 `babel.config.cjs`，`@babel/preset-react` 默认是 **classic** runtime，JSX 编译成 `React.createElement(...)`，运行时报 `ReferenceError: React is not defined`。

改成 `automatic` 与 CRA 构建行为对齐。已验证原有 Auth 测试不受影响。

### 3.2 `jest.frontend.config.js` — 扩大匹配范围

原配置的 `testMatch` 只匹配 `client/src/pages/Auth/*.test.js`，新增的测试不会被执行。已扩展：

```js
testMatch: [
  "<rootDir>/client/src/pages/Auth/*.test.js",
  "<rootDir>/client/src/pages/*.test.js",
  "<rootDir>/client/src/context/*.test.js",
],
collectCoverageFrom: [
  "client/src/pages/Auth/**",
  "client/src/pages/ProductDetails.js",
  "client/src/pages/CategoryProduct.js",
  "client/src/pages/CartPage.js",
  "client/src/context/cart.js",
],
```

`jest.backend.config.js` 未改动，`controllers/*.test.js` 已能匹配到新文件。

---

## 4. 后端测试设计

被测对象：`getProductController`、`getSingleProductController`、`productPhotoController`、`productFiltersController`、`productCountController`、`productListController`、`searchProductController`、`realtedProductController`、`productCategoryController`、`braintreeTokenController`、`brainTreePaymentController`。

这些是**单元测试**：所有协作对象（mongoose model、braintree gateway、dotenv）都替换为测试替身，不连数据库、不发网络请求。

### 4.1 可链式调用的假 Query

Controller 里大量出现链式查询，且 `await` 的是链条最后一环：

```js
await productModel.find({}).populate("category").select("-photo").limit(12).sort({ createdAt: -1 })
```

因此构造一个「每个方法都返回自身、并且自身是 thenable」的对象：

```js
const makeQuery = (result) => {
  const query = {
    populate: jest.fn(), select: jest.fn(), limit: jest.fn(),
    sort: jest.fn(), skip: jest.fn(), estimatedDocumentCount: jest.fn(),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  Object.values(query).forEach((fn) => {
    if (jest.isMockFunction(fn)) fn.mockReturnValue(query);
  });
  return query;
};
```

好处是既能被 `await` 出结果，又能反过来断言查询是否构造正确：

```js
expect(query.skip).toHaveBeenCalledWith(12);   // 第 3 页 => 跳过 (3-1)*6 条
expect(query.select).toHaveBeenCalledWith("-photo");
```

### 4.2 braintree 的 mock 必须用 `var`

`gateway` 是在 **模块加载时** 就 `new braintree.BraintreeGateway(...)` 创建的，所以 `jest.mock` 的工厂函数会在 `import productController.js` 的过程中执行。此时若工厂内部引用 `const` 声明的变量，会落在暂时性死区（TDZ）里报错。`var` 会被提升，因此安全：

```js
var mockClientTokenGenerate;
var mockTransactionSale;

jest.mock("braintree", () => {
  mockClientTokenGenerate = jest.fn();
  mockTransactionSale = jest.fn();
  return {
    __esModule: true,
    default: {
      BraintreeGateway: jest.fn(() => ({
        clientToken: { generate: mockClientTokenGenerate },
        transaction: { sale: mockTransactionSale },
      })),
      Environment: { Sandbox: "sandbox" },
    },
  };
});
```

braintree 是 callback 风格 API，成功/失败分支这样切换：

```js
mockTransactionSale.mockImplementation((_opts, cb) => cb(null, result));  // 成功
mockTransactionSale.mockImplementation((_opts, cb) => cb(err, undefined)); // 失败
```

`orderModel` 被 mock 成构造函数，并把 `save` 挂在上面便于断言：

```js
jest.mock("../models/orderModel.js", () => {
  const save = jest.fn().mockResolvedValue({});
  const OrderModel = jest.fn(() => ({ save }));
  OrderModel.__save = save;
  return { __esModule: true, default: OrderModel };
});
```

### 4.3 假的 express response

```js
const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);   // 返回 res 以支持 res.status(200).send(...)
  res.send = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  return res;
};
```

### 4.4 每个 controller 的测试场景

| Controller | 覆盖场景 |
|---|---|
| `getProductController` | 正常返回（断言 `limit(12)` / `sort` / `select("-photo")` / `counTotal`）；空目录 `counTotal: 0`；查询抛错 → 500 |
| `getSingleProductController` | 按 slug 查到；slug 不存在 → 200 + `product: null`；抛错 → 500 |
| `productPhotoController` | 有图片 → 设置 `Content-type` 并返回 Buffer；无 `photo.data` → **完全不响应**；商品不存在 → 500 |
| `productFiltersController` | 分类 + 价格区间；无筛选（`find({})`）；仅分类；仅价格；body 缺字段 → 400 |
| `productCountController` | 返回 `estimatedDocumentCount`；抛错 → 400 |
| `productListController` | 指定页 → `skip((page-1)*6)` + `limit(6)`；无 page 参数 → 默认第 1 页 `skip(0)`；抛错 → 400 |
| `searchProductController` | name/description 的大小写不敏感正则 `$or` 查询；无结果返回 `[]`；抛错 → 400 |
| `realtedProductController` | 同分类、排除自身、`limit(3)`；抛错 → 400 |
| `productCategoryController` | 先按 slug 查分类再查商品；分类查询 reject → 400 |
| `braintreeTokenController` | 返回 clientToken；gateway 回调带 error → 500；同步抛错被吞掉（不崩溃） |
| `brainTreePaymentController` | 按购物车合计金额扣款并落单（断言 amount / nonce / order 参数）；空车 amount 为 0；交易失败 → 500 且不建订单；`cart` 缺失时错误被吞掉 |

---

## 5. 前端测试设计

### 5.1 通用替身

**Layout** 会连带引入 `Header`，而 `Header` 依赖 auth / cart / search 三个 context。页面级单元测试不关心这些，直接替换：

```js
jest.mock("./../components/Layout", () => ({ children }) => (
  <div data-testid="layout">{children}</div>
));
```

> 注意：`jest.mock` 的路径要和被测文件里 `import` 的写法解析到同一个模块。`ProductDetails.js` 写的是 `"./../components/Layout"`，`CategoryProduct.js` 写的是 `"../components/Layout"`，两者在各自测试文件里都解析到 `client/src/components/Layout`。

**react-router-dom** 用 `requireActual` 展开后只覆盖需要的 hook，这样 `MemoryRouter` 等其他导出仍可用：

```js
const mockNavigate = jest.fn();
let mockParams = { slug: "textbook" };
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useParams: () => mockParams,
  useNavigate: () => mockNavigate,
}));
```

`mockParams` 用 `let` + 每个用例在 `beforeEach` 重置，就能覆盖「有 slug / 无 slug」两条分支。

**localStorage**：jsdom 自带实现，但为了断言调用参数，替换成 jest.fn：

```js
Object.defineProperty(window, "localStorage", {
  value: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
  writable: true,
});
```

**console.log**：源码的 catch 分支都是 `console.log(error)`。测试里 `jest.spyOn(console, "log").mockImplementation(() => {})`，一方面保持输出干净，另一方面可以用它断言错误分支确实走到了。

### 5.2 `ProductDetails.test.js`

| 用例 | 要点 |
|---|---|
| 按 slug 拉取并渲染详情 | 断言请求 URL、名称/描述/分类文本、价格 USD 格式化、图片 `src` 指向 `product-photo/p1` |
| 拉取相似商品 | 断言 `related-product/{pid}/{cid}` 用的是**详情响应里的** `_id` 与 `category._id`；描述截断到 60 字符 |
| 无相似商品 | 显示 `No Similar Products found` |
| 点击 More Details | `navigate("/product/notebook")` |
| URL 无 slug | 不发任何请求 |
| 详情请求失败 | 记录错误、只发了 1 次请求、页面不崩 |
| 相似商品请求失败 | 详情仍正常显示，相似区显示占位文案 |

`axios.get` 用 `mockResolvedValueOnce` 按调用顺序分别喂详情和相似商品两次响应。

### 5.3 `CategoryProduct.test.js`

覆盖：按 slug 拉取分类商品、卡片渲染（图片 / USD 价格 / 描述截断 60 字符）、空分类显示 `0 result found`、点击 More Details 跳转、无 slug 不请求、请求失败记录错误。

### 5.4 `cart.test.js`（Context）

用一个探针组件把 context 值暴露成 DOM，便于断言：

```js
const CartProbe = () => {
  const [cart, setCart] = useCart();
  return (
    <div>
      <span data-testid="count">{cart.length}</span>
      <span data-testid="names">{cart.map((c) => c.name).join(",")}</span>
      <button onClick={() => setCart([...cart, { _id: "p9", name: "Added" }])}>add</button>
    </div>
  );
};
```

覆盖：localStorage 为空时初始为空车、挂载时从 localStorage 恢复、空字符串视为无购物车、`setCart` 能更新消费者、多个消费者共享同一份购物车。

### 5.5 `CartPage.test.js`

**context 替身可切换**：`useAuth` / `useCart` 的 mock 读取 `let` 变量，每个用例在 `beforeEach` 里重置，就能自由组合「游客 / 已登录无地址 / 已登录有地址」× 「空车 / 有商品」。

```js
let mockAuth, mockSetAuth, mockCart, mockSetCart;
jest.mock("../context/auth", () => ({ useAuth: () => [mockAuth, mockSetAuth] }));
jest.mock("../context/cart", () => ({ useCart: () => [mockCart, mockSetCart] }));
```

**braintree drop-in** 是第三方 widget，替换成一个挂载后立刻回调 `onInstance` 的桩组件，这样才能测到 Make Payment 从 disabled 变 enabled、以及 `requestPaymentMethod` 失败的路径：

```js
jest.mock("braintree-web-drop-in-react", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ onInstance }) => {
      ReactLib.useEffect(() => {
        if (global.__dropinInstance) onInstance(global.__dropinInstance);
      }, []);
      return ReactLib.createElement("div", { "data-testid": "dropin" });
    },
  };
});
```

用例分组：

- **问候与摘要**：游客空车显示 `Hello Guest` / `Your Cart Is Empty`；游客有商品提示 `please login to checkout !`；已登录显示用户名且不带该提示；每个商品渲染一张卡片（描述截断 30 字符）；合计金额求和并格式化为 `$60.00`；空车 `$0.00`
- **删除商品**：删除点击项并写回 localStorage；`setCart` 抛错时记录日志且不写 localStorage
- **地址 / 登录引导**：有地址显示当前地址 + 跳 profile；已登录无地址显示 Update Address；游客显示 `Plase Login to checkout` 且 `navigate("/login", { state: "/cart" })`
- **支付 token**：挂载即请求 `braintree/token`；请求失败时记录日志且不渲染支付组件；游客 / 空车都不渲染支付组件
- **支付**：instance 未就绪时按钮 disabled；无地址时按钮 disabled；成功时 POST `{nonce, cart}` → 清 localStorage → `setCart([])` → 跳订单页 → toast 成功；支付接口失败时不清车不跳转且按钮恢复可点；`requestPaymentMethod` 失败时不调支付接口

---

## 6. 覆盖率结果

单独统计本次目标文件：

```
File                  | % Stmts | % Branch | % Funcs | % Lines
----------------------|---------|----------|---------|---------
 context/cart.js      |     100 |     100  |     100 |     100
 pages/CartPage.js    |     100 |     100  |     100 |     100
 pages/CategoryProduct|     100 |     100  |     100 |     100
 pages/ProductDetails |     100 |     100  |     100 |     100
```

`controllers/productController.js` 为 68.93% stmts —— 未覆盖的行是 `createProductController`、`updateProductController`、`deleteProductController`，属于写操作，不在本次范围内。本次涉及的 11 个 controller 的正常分支与异常分支均已覆盖。

### 已知的阈值失败

`npm run test:frontend` 目前仍会因为覆盖率阈值（100% lines/functions）失败，原因是**原有的** Auth 测试：

- `client/src/pages/Auth/Login.js` — 90.9% lines（第 44、85 行未覆盖）
- `client/src/pages/Auth/Register.js` — 96.29% lines（第 34 行未覆盖）

这在本次改动之前就已不达标（已单独验证）。要让 `npm run test` 整体通过，需要补齐 Auth 页面的用例，或调整 `coverageThreshold`。

`npm run test:backend` 同理：`collectCoverageFrom: ["controllers/**"]` 包含了尚无测试的 `authController.js` 与 `categoryController.js`。

---

## 7. 测试过程中发现的源码问题

这些是被测代码本身的缺陷，测试用例按**当前实际行为**编写，并在注释中标注。修复源码时需要同步更新对应用例。

1. **导出名拼写错误** — `controllers/productController.js` 导出的是 `realtedProductController`（不是 `related...`）。测试按实际名字导入。
2. **`productPhotoController` 在无图片时不响应** — `if (product.photo.data)` 为假时既不 `send` 也不 `next`，请求会一直挂住直到超时。建议补 404 分支。
3. **`productPhotoController` 对不存在的商品返回 500** — 读取 `null.photo` 抛 TypeError 走到 catch。语义上应为 404。
4. **`brainTreePaymentController` 未 await 订单保存** — `new orderModel(...).save()` 的 Promise 没有被等待也没有 catch，保存失败会变成 unhandled rejection，但接口已经回了 `{ok: true}`。
5. **`brainTreePaymentController` 的 catch 只打日志** — `cart` 缺失时进入 catch，不发任何响应，请求同样挂住。
6. **`CartPage.totalPrice()` 的 try/catch 是死代码** — 正常数组购物车中没有任何语句能抛错。为满足 100% 行覆盖，测试里构造了一个 `price` getter 在第二次读取时抛错的畸形商品来触达该分支，并在注释中说明。若不需要强制 100%，可删除该用例并考虑移除源码里的 try/catch。
7. **`CartPage` 中未使用的 `setAuth`** — `const [auth, setAuth] = useAuth()` 里的 `setAuth` 从未使用。
8. **`context/cart.js` 缺少 `import React`** — 见第 3.1 节，依赖 automatic JSX runtime 才能编译。

---

## 8. 约定与建议

- **单元测试不碰数据库和网络**：所有 model、gateway、axios 都必须 mock。需要验证真实查询行为时另写集成测试。
- **断言查询构造，不只断言返回值**：`skip` / `limit` / `select` / 正则条件写错是这类 controller 最常见的 bug，直接对 mock query 的调用参数下断言最有效。
- **每个 controller 至少三类用例**：正常路径、边界（空结果 / 缺省参数）、协作对象抛错时的错误分支。
- **前端优先用 `findBy*` / `waitFor`** 等待异步状态更新，避免 `act` 警告。
- 新增前端测试文件请放在 `client/src/pages/` 或 `client/src/context/` 下并以 `.test.js` 结尾，否则不会被 `jest.frontend.config.js` 匹配到。
