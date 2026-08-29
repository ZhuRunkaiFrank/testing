import React from "react";
import { render, screen, act } from "@testing-library/react";
import { CartProvider, useCart } from "./cart";

// A tiny probe component: it is the unit test's window into the context value.
const CartProbe = () => {
  const [cart, setCart] = useCart();
  return (
    <div>
      <span data-testid="count">{cart.length}</span>
      <span data-testid="names">{cart.map((c) => c.name).join(",")}</span>
      <button onClick={() => setCart([...cart, { _id: "p9", name: "Added" }])}>
        add
      </button>
    </div>
  );
};

const renderWithProvider = () =>
  render(
    <CartProvider>
      <CartProbe />
    </CartProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    },
    writable: true,
  });
});

describe("CartProvider / useCart", () => {
  it("starts with an empty cart when localStorage has nothing", () => {
    window.localStorage.getItem.mockReturnValue(null);

    renderWithProvider();

    expect(window.localStorage.getItem).toHaveBeenCalledWith("cart");
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("hydrates the cart from localStorage on mount", () => {
    window.localStorage.getItem.mockReturnValue(
      JSON.stringify([
        { _id: "p1", name: "Textbook" },
        { _id: "p2", name: "Novel" },
      ])
    );

    renderWithProvider();

    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByTestId("names")).toHaveTextContent("Textbook,Novel");
  });

  it("treats an empty string in localStorage as no cart", () => {
    window.localStorage.getItem.mockReturnValue("");

    renderWithProvider();

    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("exposes a setter that updates the cart for consumers", () => {
    window.localStorage.getItem.mockReturnValue(null);

    renderWithProvider();
    act(() => {
      screen.getByText("add").click();
    });

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("names")).toHaveTextContent("Added");
  });

  it("shares one cart between multiple consumers", () => {
    window.localStorage.getItem.mockReturnValue(
      JSON.stringify([{ _id: "p1", name: "Textbook" }])
    );

    render(
      <CartProvider>
        <CartProbe />
        <CartProbe />
      </CartProvider>
    );

    const counts = screen.getAllByTestId("count");
    expect(counts).toHaveLength(2);
    counts.forEach((c) => expect(c).toHaveTextContent("1"));
  });
});
