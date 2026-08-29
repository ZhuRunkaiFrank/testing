import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import axios from "axios";
import CategoryProduct from "./CategoryProduct";

jest.mock("axios");

jest.mock("../components/Layout", () => ({ children }) => (
  <div data-testid="layout">{children}</div>
));

const mockNavigate = jest.fn();
let mockParams = { slug: "books" };
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useParams: () => mockParams,
  useNavigate: () => mockNavigate,
}));

const category = { _id: "c1", name: "Books", slug: "books" };
const products = [
  {
    _id: "p1",
    name: "Textbook",
    slug: "textbook",
    price: 49.99,
    description: "y".repeat(80),
  },
  {
    _id: "p2",
    name: "Novel",
    slug: "novel",
    price: 12,
    description: "short",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { slug: "books" };
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CategoryProduct", () => {
  it("fetches products for the category in the url", async () => {
    axios.get.mockResolvedValueOnce({ data: { category, products } });

    render(<CategoryProduct />);

    await waitFor(() =>
      expect(axios.get).toHaveBeenCalledWith(
        "/api/v1/product/product-category/books"
      )
    );
    expect(await screen.findByText("Category - Books")).toBeInTheDocument();
    expect(screen.getByText("2 result found")).toBeInTheDocument();
  });

  it("renders each product card with photo, formatted price and truncated description", async () => {
    axios.get.mockResolvedValueOnce({ data: { category, products } });

    render(<CategoryProduct />);

    expect(await screen.findByText("Textbook")).toBeInTheDocument();
    expect(screen.getByText("Novel")).toBeInTheDocument();
    expect(screen.getByText("$49.99")).toBeInTheDocument();
    expect(screen.getByText("$12.00")).toBeInTheDocument();
    expect(screen.getByText(`${"y".repeat(60)}...`)).toBeInTheDocument();
    expect(screen.getByAltText("Textbook")).toHaveAttribute(
      "src",
      "/api/v1/product/product-photo/p1"
    );
  });

  it("shows 0 results for an empty category", async () => {
    axios.get.mockResolvedValueOnce({
      data: { category, products: [] },
    });

    render(<CategoryProduct />);

    expect(await screen.findByText("0 result found")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("navigates to the product page when More Details is clicked", async () => {
    axios.get.mockResolvedValueOnce({ data: { category, products } });

    render(<CategoryProduct />);

    const buttons = await screen.findAllByRole("button", {
      name: "More Details",
    });
    fireEvent.click(buttons[1]);

    expect(mockNavigate).toHaveBeenCalledWith("/product/novel");
  });

  it("does not fetch when the slug is absent", async () => {
    mockParams = {};

    render(<CategoryProduct />);

    await waitFor(() => expect(axios.get).not.toHaveBeenCalled());
    expect(screen.getByText("Category -")).toBeInTheDocument();
  });

  it("logs the error and renders no products when the request fails", async () => {
    const error = new Error("boom");
    axios.get.mockRejectedValueOnce(error);

    render(<CategoryProduct />);

    await waitFor(() => expect(console.log).toHaveBeenCalledWith(error));
    expect(screen.getByText("0 result found")).toBeInTheDocument();
  });
});
