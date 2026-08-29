import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import axios from "axios";
import toast from "react-hot-toast";
import CartPage from "./CartPage";

jest.mock("axios");
jest.mock("react-hot-toast", () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock("./../components/Layout", () => ({ children }) => (
  <div data-testid="layout">{children}</div>
));

// The braintree drop-in is a third-party widget: replace it with a stub that
// immediately hands the page a fake payment instance.
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

let mockAuth;
let mockSetAuth;
let mockCart;
let mockSetCart;
const mockNavigate = jest.fn();

jest.mock("../context/auth", () => ({
  useAuth: () => [mockAuth, mockSetAuth],
}));
jest.mock("../context/cart", () => ({
  useCart: () => [mockCart, mockSetCart],
}));
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

const cartItems = [
  {
    _id: "p1",
    name: "Textbook",
    description: "a fairly long product description here",
    price: 49.99,
  },
  { _id: "p2", name: "Novel", description: "short", price: 10.01 },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  mockAuth = null;
  mockSetAuth = jest.fn();
  mockCart = [];
  mockSetCart = jest.fn();
  global.__dropinInstance = null;
  axios.get.mockResolvedValue({ data: { clientToken: "tok_123" } });
  axios.post.mockResolvedValue({ data: { ok: true } });
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    },
    writable: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CartPage - greeting and cart summary", () => {
  it("greets a guest with an empty cart", async () => {
    render(<CartPage />);

    expect(screen.getByText("Hello Guest")).toBeInTheDocument();
    expect(screen.getByText("Your Cart Is Empty")).toBeInTheDocument();
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });

  it("asks an anonymous visitor with items to log in before checkout", async () => {
    mockCart = cartItems;

    render(<CartPage />);

    expect(
      screen.getByText(
        "You Have 2 items in your cart please login to checkout !"
      )
    ).toBeInTheDocument();
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });

  it("greets a logged in user and drops the login hint", async () => {
    mockAuth = { token: "t", user: { name: "Alice" } };
    mockCart = cartItems;

    render(<CartPage />);

    expect(screen.getByText("Hello Alice")).toBeInTheDocument();
    expect(
      screen.getByText("You Have 2 items in your cart")
    ).toBeInTheDocument();
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });

  it("renders one card per cart item with a truncated description", async () => {
    mockCart = cartItems;

    render(<CartPage />);

    expect(screen.getByText("Textbook")).toBeInTheDocument();
    expect(screen.getByText("Novel")).toBeInTheDocument();
    expect(screen.getByText("Price : 49.99")).toBeInTheDocument();
    expect(
      screen.getByText(cartItems[0].description.substring(0, 30))
    ).toBeInTheDocument();
    expect(screen.getByAltText("Textbook")).toHaveAttribute(
      "src",
      "/api/v1/product/product-photo/p1"
    );
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });

  it("sums the cart and formats the total as USD", async () => {
    mockCart = cartItems;

    render(<CartPage />);

    expect(screen.getByText("Total : $60.00")).toBeInTheDocument();
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });

  it("shows a $0.00 total for an empty cart", async () => {
    render(<CartPage />);

    expect(screen.getByText("Total : $0.00")).toBeInTheDocument();
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });

  // totalPrice() has a try/catch, but with a plain cart array nothing inside it
  // can throw, so the catch is effectively dead code. Reaching it needs an item
  // whose price cannot be read - kept here only to document that branch.
  it("logs instead of crashing when an item price cannot be read", async () => {
    let reads = 0;
    mockCart = [
      {
        _id: "p1",
        name: "Broken",
        description: "broken item",
        get price() {
          reads += 1;
          // read #1 is the product card, read #2 is totalPrice()
          if (reads === 2) throw new Error("unreadable price");
          return 1;
        },
      },
    ];

    render(<CartPage />);

    expect(console.log).toHaveBeenCalled();
    expect(screen.getByText("Broken")).toBeInTheDocument();
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });
});

describe("CartPage - removing items", () => {
  it("removes the clicked item and persists the new cart", async () => {
    mockCart = cartItems;

    render(<CartPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    expect(mockSetCart).toHaveBeenCalledWith([cartItems[1]]);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      "cart",
      JSON.stringify([cartItems[1]])
    );
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });

  it("logs and keeps the cart untouched when removal throws", async () => {
    mockCart = cartItems;
    mockSetCart.mockImplementation(() => {
      throw new Error("setCart failed");
    });

    render(<CartPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);

    expect(console.log).toHaveBeenCalled();
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });
});

describe("CartPage - address / login call to action", () => {
  it("shows the current address and lets the user update it", async () => {
    mockAuth = {
      token: "t",
      user: { name: "Alice", address: "1 Kent Ridge Rd" },
    };

    render(<CartPage />);
    expect(screen.getByText("Current Address")).toBeInTheDocument();
    expect(screen.getByText("1 Kent Ridge Rd")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update Address" }));
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/user/profile");
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });

  it("prompts a logged in user without an address to add one", async () => {
    mockAuth = { token: "t", user: { name: "Alice" } };

    render(<CartPage />);

    expect(screen.queryByText("Current Address")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update Address" }));
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/user/profile");
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });

  it("sends a guest to login, remembering /cart as the return route", async () => {
    render(<CartPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Plase Login to checkout" })
    );
    expect(mockNavigate).toHaveBeenCalledWith("/login", { state: "/cart" });
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
  });
});

describe("CartPage - braintree token", () => {
  it("fetches the client token on mount", async () => {
    render(<CartPage />);

    await waitFor(() =>
      expect(axios.get).toHaveBeenCalledWith("/api/v1/product/braintree/token")
    );
  });

  it("logs and hides the payment widget when the token request fails", async () => {
    const error = new Error("token failed");
    axios.get.mockRejectedValueOnce(error);
    mockAuth = { token: "t", user: { name: "Alice", address: "addr" } };
    mockCart = cartItems;

    render(<CartPage />);

    await waitFor(() => expect(console.log).toHaveBeenCalledWith(error));
    expect(screen.queryByTestId("dropin")).not.toBeInTheDocument();
  });

  it("hides the payment widget for a guest even once the token arrives", async () => {
    mockCart = cartItems;

    render(<CartPage />);

    await waitFor(() => expect(axios.get).toHaveBeenCalled());
    expect(screen.queryByTestId("dropin")).not.toBeInTheDocument();
  });

  it("hides the payment widget when the cart is empty", async () => {
    mockAuth = { token: "t", user: { name: "Alice", address: "addr" } };

    render(<CartPage />);

    await waitFor(() => expect(axios.get).toHaveBeenCalled());
    expect(screen.queryByTestId("dropin")).not.toBeInTheDocument();
  });
});

describe("CartPage - payment", () => {
  const loggedInWithAddress = {
    token: "t",
    user: { name: "Alice", address: "1 Kent Ridge Rd" },
  };

  it("disables Make Payment until the drop-in instance is ready", async () => {
    mockAuth = loggedInWithAddress;
    mockCart = cartItems;
    global.__dropinInstance = null;

    render(<CartPage />);

    expect(await screen.findByTestId("dropin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make Payment" })).toBeDisabled();
  });

  it("disables Make Payment when the user has no address", async () => {
    mockAuth = { token: "t", user: { name: "Alice" } };
    mockCart = cartItems;
    global.__dropinInstance = {
      requestPaymentMethod: jest.fn().mockResolvedValue({ nonce: "n1" }),
    };

    render(<CartPage />);

    expect(await screen.findByTestId("dropin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make Payment" })).toBeDisabled();
  });

  it("posts the nonce and cart, clears the cart and redirects on success", async () => {
    mockAuth = loggedInWithAddress;
    mockCart = cartItems;
    global.__dropinInstance = {
      requestPaymentMethod: jest.fn().mockResolvedValue({ nonce: "nonce-1" }),
    };

    render(<CartPage />);
    const payBtn = await screen.findByRole("button", { name: "Make Payment" });
    await waitFor(() => expect(payBtn).toBeEnabled());
    fireEvent.click(payBtn);

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(
        "/api/v1/product/braintree/payment",
        { nonce: "nonce-1", cart: cartItems }
      )
    );
    expect(window.localStorage.removeItem).toHaveBeenCalledWith("cart");
    expect(mockSetCart).toHaveBeenCalledWith([]);
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/user/orders");
    expect(toast.success).toHaveBeenCalledWith(
      "Payment Completed Successfully "
    );
  });

  it("does not clear the cart or redirect when the payment request fails", async () => {
    mockAuth = loggedInWithAddress;
    mockCart = cartItems;
    const error = new Error("payment declined");
    axios.post.mockRejectedValueOnce(error);
    global.__dropinInstance = {
      requestPaymentMethod: jest.fn().mockResolvedValue({ nonce: "nonce-1" }),
    };

    render(<CartPage />);
    const payBtn = await screen.findByRole("button", { name: "Make Payment" });
    await waitFor(() => expect(payBtn).toBeEnabled());
    fireEvent.click(payBtn);

    await waitFor(() => expect(console.log).toHaveBeenCalledWith(error));
    expect(window.localStorage.removeItem).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    // loading was reset, so the button is clickable again
    expect(screen.getByRole("button", { name: "Make Payment" })).toBeEnabled();
  });

  it("does not call the payment api when the drop-in cannot produce a nonce", async () => {
    mockAuth = loggedInWithAddress;
    mockCart = cartItems;
    const error = new Error("no payment method");
    global.__dropinInstance = {
      requestPaymentMethod: jest.fn().mockRejectedValue(error),
    };

    render(<CartPage />);
    const payBtn = await screen.findByRole("button", { name: "Make Payment" });
    await waitFor(() => expect(payBtn).toBeEnabled());
    fireEvent.click(payBtn);

    await waitFor(() => expect(console.log).toHaveBeenCalledWith(error));
    expect(axios.post).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
