/**
 * Unit tests for the Product read / search / payment controllers.
 *
 * Strategy: these are *unit* tests, so every collaborator of the controller
 * (mongoose models, braintree gateway) is replaced with a test double.
 * We only assert on what the controller itself is responsible for:
 *   1. the query it builds,
 *   2. the status code it returns,
 *   3. the payload it sends,
 *   4. its behaviour when a collaborator throws.
 */

// ---------------------------------------------------------------------------
// Mocks. Note the `var` declarations: jest.mock factories are hoisted above
// the imports, and they run while productController.js is being loaded, so a
// `const` here would still be in its temporal dead zone. `var` is hoisted and
// gets assigned by the factory before any test body runs.
// ---------------------------------------------------------------------------
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

jest.mock("dotenv", () => ({
  __esModule: true,
  default: { config: jest.fn() },
}));

jest.mock("../models/productModel.js", () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
  },
}));

jest.mock("../models/categoryModel.js", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("../models/orderModel.js", () => {
  const save = jest.fn().mockResolvedValue({});
  const OrderModel = jest.fn(() => ({ save }));
  OrderModel.__save = save;
  return { __esModule: true, default: OrderModel };
});

import productModel from "../models/productModel.js";
import categoryModel from "../models/categoryModel.js";
import orderModel from "../models/orderModel.js";
import {
  getProductController,
  getSingleProductController,
  productPhotoController,
  productFiltersController,
  productCountController,
  productListController,
  searchProductController,
  realtedProductController,
  productCategoryController,
  braintreeTokenController,
  brainTreePaymentController,
} from "./productController.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A fake mongoose Query: every chainable method returns the query itself, and
 * the object is a thenable so `await query` resolves to `result`.
 */
const makeQuery = (result) => {
  const query = {
    populate: jest.fn(),
    select: jest.fn(),
    limit: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    estimatedDocumentCount: jest.fn(),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  Object.values(query).forEach((fn) => {
    if (jest.isMockFunction(fn)) fn.mockReturnValue(query);
  });
  return query;
};

/** A fake express response that records what the controller did. */
const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getProductController
// ---------------------------------------------------------------------------
describe("getProductController", () => {
  it("returns the 12 newest products without their photo blobs", async () => {
    const products = [{ _id: "p1" }, { _id: "p2" }];
    const query = makeQuery(products);
    productModel.find.mockReturnValue(query);
    const res = makeRes();

    await getProductController({}, res);

    expect(productModel.find).toHaveBeenCalledWith({});
    expect(query.populate).toHaveBeenCalledWith("category");
    expect(query.select).toHaveBeenCalledWith("-photo");
    expect(query.limit).toHaveBeenCalledWith(12);
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      counTotal: 2,
      message: "ALlProducts ",
      products,
    });
  });

  it("reports an empty catalogue with counTotal 0", async () => {
    productModel.find.mockReturnValue(makeQuery([]));
    const res = makeRes();

    await getProductController({}, res);

    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ counTotal: 0, products: [] })
    );
  });

  it("returns 500 with the error message when the query fails", async () => {
    productModel.find.mockImplementation(() => {
      throw new Error("db down");
    });
    const res = makeRes();

    await getProductController({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({
      success: false,
      message: "Erorr in getting products",
      error: "db down",
    });
  });
});

// ---------------------------------------------------------------------------
// getSingleProductController
// ---------------------------------------------------------------------------
describe("getSingleProductController", () => {
  it("looks the product up by slug and returns it", async () => {
    const product = { _id: "p1", slug: "nice-book" };
    const query = makeQuery(product);
    productModel.findOne.mockReturnValue(query);
    const res = makeRes();

    await getSingleProductController({ params: { slug: "nice-book" } }, res);

    expect(productModel.findOne).toHaveBeenCalledWith({ slug: "nice-book" });
    expect(query.select).toHaveBeenCalledWith("-photo");
    expect(query.populate).toHaveBeenCalledWith("category");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      message: "Single Product Fetched",
      product,
    });
  });

  it("still answers 200 with product null for an unknown slug", async () => {
    productModel.findOne.mockReturnValue(makeQuery(null));
    const res = makeRes();

    await getSingleProductController({ params: { slug: "ghost" } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ product: null })
    );
  });

  it("returns 500 when the query throws", async () => {
    const error = new Error("boom");
    productModel.findOne.mockImplementation(() => {
      throw error;
    });
    const res = makeRes();

    await getSingleProductController({ params: { slug: "x" } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({
      success: false,
      message: "Eror while getitng single product",
      error,
    });
  });
});

// ---------------------------------------------------------------------------
// productPhotoController
// ---------------------------------------------------------------------------
describe("productPhotoController", () => {
  it("streams the photo buffer with the stored content type", async () => {
    const data = Buffer.from("image-bytes");
    const query = makeQuery({ photo: { data, contentType: "image/png" } });
    productModel.findById.mockReturnValue(query);
    const res = makeRes();

    await productPhotoController({ params: { pid: "p1" } }, res);

    expect(productModel.findById).toHaveBeenCalledWith("p1");
    expect(query.select).toHaveBeenCalledWith("photo");
    expect(res.set).toHaveBeenCalledWith("Content-type", "image/png");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(data);
  });

  it("sends nothing when the product has no photo data", async () => {
    productModel.findById.mockReturnValue(makeQuery({ photo: {} }));
    const res = makeRes();

    await productPhotoController({ params: { pid: "p1" } }, res);

    expect(res.send).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 500 when the product does not exist (photo of null)", async () => {
    productModel.findById.mockReturnValue(makeQuery(null));
    const res = makeRes();

    await productPhotoController({ params: { pid: "missing" } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Erorr while getting photo",
      })
    );
  });
});

// ---------------------------------------------------------------------------
// productFiltersController
// ---------------------------------------------------------------------------
describe("productFiltersController", () => {
  it("filters by category and price range when both are given", async () => {
    productModel.find.mockReturnValue(makeQuery([{ _id: "p1" }]));
    const res = makeRes();

    await productFiltersController(
      { body: { checked: ["c1", "c2"], radio: [20, 60] } },
      res
    );

    expect(productModel.find).toHaveBeenCalledWith({
      category: ["c1", "c2"],
      price: { $gte: 20, $lte: 60 },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      products: [{ _id: "p1" }],
    });
  });

  it("queries everything when no filter is selected", async () => {
    productModel.find.mockReturnValue(makeQuery([]));
    const res = makeRes();

    await productFiltersController({ body: { checked: [], radio: [] } }, res);

    expect(productModel.find).toHaveBeenCalledWith({});
  });

  it("filters by category only", async () => {
    productModel.find.mockReturnValue(makeQuery([]));
    const res = makeRes();

    await productFiltersController({ body: { checked: ["c1"], radio: [] } }, res);

    expect(productModel.find).toHaveBeenCalledWith({ category: ["c1"] });
  });

  it("filters by price only", async () => {
    productModel.find.mockReturnValue(makeQuery([]));
    const res = makeRes();

    await productFiltersController({ body: { checked: [], radio: [0, 9] } }, res);

    expect(productModel.find).toHaveBeenCalledWith({
      price: { $gte: 0, $lte: 9 },
    });
  });

  it("returns 400 when the body is malformed", async () => {
    const res = makeRes();

    await productFiltersController({ body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Error WHile Filtering Products",
      })
    );
  });
});

// ---------------------------------------------------------------------------
// productCountController
// ---------------------------------------------------------------------------
describe("productCountController", () => {
  it("returns the estimated document count", async () => {
    const query = makeQuery(42);
    productModel.find.mockReturnValue(query);
    const res = makeRes();

    await productCountController({}, res);

    expect(query.estimatedDocumentCount).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, total: 42 });
  });

  it("returns 400 when counting fails", async () => {
    productModel.find.mockImplementation(() => {
      throw new Error("count failed");
    });
    const res = makeRes();

    await productCountController({}, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Error in product count" })
    );
  });
});

// ---------------------------------------------------------------------------
// productListController
// ---------------------------------------------------------------------------
describe("productListController", () => {
  it("skips (page - 1) * 6 documents for the requested page", async () => {
    const query = makeQuery([{ _id: "p7" }]);
    productModel.find.mockReturnValue(query);
    const res = makeRes();

    await productListController({ params: { page: 3 } }, res);

    expect(query.skip).toHaveBeenCalledWith(12);
    expect(query.limit).toHaveBeenCalledWith(6);
    expect(query.select).toHaveBeenCalledWith("-photo");
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      products: [{ _id: "p7" }],
    });
  });

  it("defaults to page 1 when no page param is supplied", async () => {
    const query = makeQuery([]);
    productModel.find.mockReturnValue(query);
    const res = makeRes();

    await productListController({ params: {} }, res);

    expect(query.skip).toHaveBeenCalledWith(0);
  });

  it("returns 400 when the query fails", async () => {
    productModel.find.mockImplementation(() => {
      throw new Error("nope");
    });
    const res = makeRes();

    await productListController({ params: { page: 1 } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ message: "error in per page ctrl" })
    );
  });
});

// ---------------------------------------------------------------------------
// searchProductController
// ---------------------------------------------------------------------------
describe("searchProductController", () => {
  it("does a case-insensitive regex search on name and description", async () => {
    const results = [{ _id: "p1", name: "Textbook" }];
    const query = makeQuery(results);
    productModel.find.mockReturnValue(query);
    const res = makeRes();

    await searchProductController({ params: { keyword: "book" } }, res);

    expect(productModel.find).toHaveBeenCalledWith({
      $or: [
        { name: { $regex: "book", $options: "i" } },
        { description: { $regex: "book", $options: "i" } },
      ],
    });
    expect(query.select).toHaveBeenCalledWith("-photo");
    expect(res.json).toHaveBeenCalledWith(results);
  });

  it("returns an empty array when nothing matches", async () => {
    productModel.find.mockReturnValue(makeQuery([]));
    const res = makeRes();

    await searchProductController({ params: { keyword: "zzz" } }, res);

    expect(res.json).toHaveBeenCalledWith([]);
  });

  it("returns 400 when the search fails", async () => {
    productModel.find.mockImplementation(() => {
      throw new Error("bad regex");
    });
    const res = makeRes();

    await searchProductController({ params: { keyword: "(" } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Error In Search Product API" })
    );
  });
});

// ---------------------------------------------------------------------------
// realtedProductController  (note: the export name is misspelled in source)
// ---------------------------------------------------------------------------
describe("realtedProductController", () => {
  it("returns up to 3 products from the same category, excluding itself", async () => {
    const products = [{ _id: "p2" }];
    const query = makeQuery(products);
    productModel.find.mockReturnValue(query);
    const res = makeRes();

    await realtedProductController({ params: { pid: "p1", cid: "c1" } }, res);

    expect(productModel.find).toHaveBeenCalledWith({
      category: "c1",
      _id: { $ne: "p1" },
    });
    expect(query.select).toHaveBeenCalledWith("-photo");
    expect(query.limit).toHaveBeenCalledWith(3);
    expect(query.populate).toHaveBeenCalledWith("category");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, products });
  });

  it("returns 400 when the query fails", async () => {
    productModel.find.mockImplementation(() => {
      throw new Error("fail");
    });
    const res = makeRes();

    await realtedProductController({ params: { pid: "p1", cid: "c1" } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ message: "error while geting related product" })
    );
  });
});

// ---------------------------------------------------------------------------
// productCategoryController
// ---------------------------------------------------------------------------
describe("productCategoryController", () => {
  it("resolves the category by slug then returns its products", async () => {
    const category = { _id: "c1", slug: "books", name: "Books" };
    const products = [{ _id: "p1" }];
    categoryModel.findOne.mockResolvedValue(category);
    const query = makeQuery(products);
    productModel.find.mockReturnValue(query);
    const res = makeRes();

    await productCategoryController({ params: { slug: "books" } }, res);

    expect(categoryModel.findOne).toHaveBeenCalledWith({ slug: "books" });
    expect(productModel.find).toHaveBeenCalledWith({ category });
    expect(query.populate).toHaveBeenCalledWith("category");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      category,
      products,
    });
  });

  it("returns 400 when the category lookup rejects", async () => {
    categoryModel.findOne.mockRejectedValue(new Error("no category"));
    const res = makeRes();

    await productCategoryController({ params: { slug: "books" } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Error While Getting products" })
    );
  });
});

// ---------------------------------------------------------------------------
// braintreeTokenController
// ---------------------------------------------------------------------------
describe("braintreeTokenController", () => {
  it("sends the generated client token", async () => {
    const response = { clientToken: "tok_123" };
    mockClientTokenGenerate.mockImplementation((_opts, cb) => cb(null, response));
    const res = makeRes();

    await braintreeTokenController({}, res);

    expect(mockClientTokenGenerate).toHaveBeenCalledWith({}, expect.any(Function));
    expect(res.send).toHaveBeenCalledWith(response);
  });

  it("sends 500 with the gateway error", async () => {
    const err = new Error("gateway unavailable");
    mockClientTokenGenerate.mockImplementation((_opts, cb) => cb(err, null));
    const res = makeRes();

    await braintreeTokenController({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith(err);
  });

  it("swallows a synchronous gateway failure without crashing", async () => {
    mockClientTokenGenerate.mockImplementation(() => {
      throw new Error("sync boom");
    });
    const res = makeRes();

    await expect(braintreeTokenController({}, res)).resolves.toBeUndefined();
    expect(res.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// brainTreePaymentController
// ---------------------------------------------------------------------------
describe("brainTreePaymentController", () => {
  const cart = [{ _id: "p1", price: 10.5 }, { _id: "p2", price: 4.5 }];

  it("charges the cart total and persists the order", async () => {
    const result = { success: true, transaction: { id: "t1" } };
    mockTransactionSale.mockImplementation((_opts, cb) => cb(null, result));
    const res = makeRes();

    await brainTreePaymentController(
      { body: { nonce: "fake-nonce", cart }, user: { _id: "u1" } },
      res
    );

    expect(mockTransactionSale).toHaveBeenCalledWith(
      {
        amount: 15,
        paymentMethodNonce: "fake-nonce",
        options: { submitForSettlement: true },
      },
      expect.any(Function)
    );
    expect(orderModel).toHaveBeenCalledWith({
      products: cart,
      payment: result,
      buyer: "u1",
    });
    expect(orderModel.__save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it("charges 0 for an empty cart", async () => {
    mockTransactionSale.mockImplementation((_opts, cb) => cb(null, { ok: 1 }));
    const res = makeRes();

    await brainTreePaymentController(
      { body: { nonce: "n", cart: [] }, user: { _id: "u1" } },
      res
    );

    expect(mockTransactionSale).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 0 }),
      expect.any(Function)
    );
  });

  it("returns 500 and creates no order when the sale fails", async () => {
    const err = new Error("declined");
    mockTransactionSale.mockImplementation((_opts, cb) => cb(err, undefined));
    const res = makeRes();

    await brainTreePaymentController(
      { body: { nonce: "n", cart }, user: { _id: "u1" } },
      res
    );

    expect(orderModel).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith(err);
  });

  it("swallows the error when the cart is missing", async () => {
    const res = makeRes();

    await expect(
      brainTreePaymentController({ body: {}, user: { _id: "u1" } }, res)
    ).resolves.toBeUndefined();
    expect(mockTransactionSale).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
