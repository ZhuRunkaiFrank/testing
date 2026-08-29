import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import axios from "axios";
import ProductDetails from "./ProductDetails";

jest.mock("axios");

// Layout drags in Header -> auth/cart/search contexts. For a unit test of this
// page we only care about the children it renders.
jest.mock("./../components/Layout", () => ({ children }) => (
  <div data-testid="layout">{children}</div>
));

const mockNavigate = jest.fn();
let mockParams = { slug: "textbook" };
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useParams: () => mockParams,
  useNavigate: () => mockNavigate,
}));

const product = {
  _id: "p1",
  name: "Textbook",
  description: "A very long description of the textbook",
  price: 49.99,
  slug: "textbook",
  category: { _id: "c1", name: "Books" },
};

const related = [
  {
    _id: "p2",
    name: "Notebook",
    slug: "notebook",
    price: 5,
    description: "x".repeat(100),
  },
  {
    _id: "p3",
    name: "Pencil",
    slug: "pencil",
    price: 1.5,
    description: "short desc",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { slug: "textbook" };
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProductDetails", () => {
  it("fetches the product by slug and renders its details", async () => {
    axios.get
      .mockResolvedValueOnce({ data: { product } })
      .mockResolvedValueOnce({ data: { products: [] } });

    render(<ProductDetails />);

    await waitFor(() =>
      expect(axios.get).toHaveBeenCalledWith(
        "/api/v1/product/get-product/textbook"
      )
    );
    expect(await screen.findByText("Name : Textbook")).toBeInTheDocument();
    expect(
      screen.getByText("Description : A very long description of the textbook")
    ).toBeInTheDocument();
    expect(screen.getByText(/\$49\.99/)).toBeInTheDocument();
    expect(screen.getByText("Category : Books")).toBeInTheDocument();
    expect(screen.getByAltText("Textbook")).toHaveAttribute(
      "src",
      "/api/v1/product/product-photo/p1"
    );
  });

  it("requests similar products with the product id and its category id", async () => {
    axios.get
      .mockResolvedValueOnce({ data: { product } })
      .mockResolvedValueOnce({ data: { products: related } });

    render(<ProductDetails />);

    await waitFor(() =>
      expect(axios.get).toHaveBeenCalledWith(
        "/api/v1/product/related-product/p1/c1"
      )
    );
    expect(await screen.findByText("Notebook")).toBeInTheDocument();
    expect(screen.getByText("Pencil")).toBeInTheDocument();
    // description is truncated to 60 chars
    expect(screen.getByText(`${"x".repeat(60)}...`)).toBeInTheDocument();
  });

  it("shows a placeholder when there are no similar products", async () => {
    axios.get
      .mockResolvedValueOnce({ data: { product } })
      .mockResolvedValueOnce({ data: { products: [] } });

    render(<ProductDetails />);

    expect(
      await screen.findByText("No Similar Products found")
    ).toBeInTheDocument();
  });

  it("navigates to a similar product when More Details is clicked", async () => {
    axios.get
      .mockResolvedValueOnce({ data: { product } })
      .mockResolvedValueOnce({ data: { products: related } });

    render(<ProductDetails />);

    const buttons = await screen.findAllByRole("button", {
      name: "More Details",
    });
    fireEvent.click(buttons[0]);

    expect(mockNavigate).toHaveBeenCalledWith("/product/notebook");
  });

  it("does not fetch anything when there is no slug in the url", async () => {
    mockParams = {};

    render(<ProductDetails />);

    await waitFor(() => expect(axios.get).not.toHaveBeenCalled());
    expect(screen.getByText("Name :")).toBeInTheDocument();
  });

  it("logs and keeps rendering when the product request fails", async () => {
    const error = new Error("network down");
    axios.get.mockRejectedValueOnce(error);

    render(<ProductDetails />);

    await waitFor(() => expect(console.log).toHaveBeenCalledWith(error));
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No Similar Products found")).toBeInTheDocument();
  });

  it("logs and shows no similar products when the related request fails", async () => {
    const error = new Error("related failed");
    axios.get
      .mockResolvedValueOnce({ data: { product } })
      .mockRejectedValueOnce(error);

    render(<ProductDetails />);

    await waitFor(() => expect(console.log).toHaveBeenCalledWith(error));
    expect(await screen.findByText("Name : Textbook")).toBeInTheDocument();
    expect(screen.getByText("No Similar Products found")).toBeInTheDocument();
  });
});
