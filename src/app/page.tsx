"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  type MenuAddOn,
  type MenuCustomization,
  type MenuPortion,
  type MenuProduct,
} from "@/data/menu";

type CartItem = {
  id: string;
  productId: string;
  productName: string;
  portionSizeMl: number;
  quantity: number;
  unitPriceInPaise: number;
  selections: string[];
  customizationSelections: Record<string, string>;
  addOnIds: string[];
};

const heroImage =
  "https://images.unsplash.com/photo-1603105037880-880cd4edfb0d?auto=format&fit=crop&w=1800&q=88";

function formatPrice(priceInPaise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(priceInPaise / 100);
}

function Eyebrow({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="eyebrow">{children}</p>;
}

function getCustomizationPrice(
  customizations: MenuCustomization[] | undefined,
  selections: Record<string, string>,
) {
  return (customizations ?? []).reduce((total, customization) => {
    const selectedOption = customization.options.find(
      (option) => option.id === selections[customization.id],
    );
    return total + (selectedOption?.priceInPaise ?? 0);
  }, 0);
}

function getAddOnPrice(addOns: MenuAddOn[] | undefined, selectedIds: string[]) {
  return (addOns ?? [])
    .filter((addOn) => selectedIds.includes(addOn.id))
    .reduce((total, addOn) => total + addOn.priceInPaise, 0);
}

export default function Home() {
  const router = useRouter();
  const [products, setProducts] = useState<MenuProduct[]>([]);
  const [menuStatus, setMenuStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [menuError, setMenuError] = useState("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartError, setCartError] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<MenuProduct | null>(
    null,
  );
  const [portionByProduct, setPortionByProduct] = useState<
    Record<string, number>
  >({});
  const [quantityByProduct, setQuantityByProduct] = useState<
    Record<string, number>
  >({});
  const [detailPortionSize, setDetailPortionSize] = useState(0);
  const [detailQuantity, setDetailQuantity] = useState(1);
  const [detailCustomizations, setDetailCustomizations] = useState<
    Record<string, string>
  >({});
  const [detailAddOns, setDetailAddOns] = useState<string[]>([]);

  async function loadMenu() {
    setMenuStatus("loading");
    setMenuError("");
    try {
      const response = await fetch("/api/menu", { cache: "no-store" });
      if (!response.ok) throw new Error("The menu could not be loaded.");
      const result = (await response.json()) as { products: MenuProduct[] };
      setProducts(result.products);
      setMenuStatus("ready");
    } catch (error) {
      console.error("Unable to load the menu.", error);
      setMenuError(
        error instanceof Error
          ? error.message
          : "The menu could not be loaded. Please try again.",
      );
      setMenuStatus("error");
    }
  }

  useEffect(() => {
    void loadMenu();
  }, []);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      product.name.toLocaleLowerCase().includes(query),
    );
  }, [products, search]);

  const cartCount = useMemo(
    () => cart.reduce((total, item) => total + item.quantity, 0),
    [cart],
  );

  const cartSubtotal = useMemo(
    () =>
      cart.reduce(
        (total, item) => total + item.unitPriceInPaise * item.quantity,
        0,
      ),
    [cart],
  );

  function addToCart(
    product: MenuProduct,
    portion: MenuPortion,
    quantity: number,
    customizationSelections: Record<string, string> = {},
    addOnSelections: string[] = [],
  ) {
    if (product.availability !== "available") return;

    const selectedLabels = (product.customizations ?? []).flatMap(
      (customization) => {
        const option = customization.options.find(
          (choice) => choice.id === customizationSelections[customization.id],
        );
        return option ? [`${customization.label}: ${option.name}`] : [];
      },
    );
    const selectedAddOns = (product.addOns ?? []).filter((addOn) =>
      addOnSelections.includes(addOn.id),
    );
    const selections = [
      ...selectedLabels,
      ...selectedAddOns.map((addOn) => `Add-on: ${addOn.name}`),
    ];
    const unitPriceInPaise =
      portion.priceInPaise +
      getCustomizationPrice(product.customizations, customizationSelections) +
      getAddOnPrice(product.addOns, addOnSelections);
    const id = [
      product.id,
      portion.sizeInMl,
      ...selections.slice().sort(),
    ].join("|");

    setCartError("");
    setCart((items) => {
      const existing = items.find((item) => item.id === id);
      if (existing) {
        return items.map((item) =>
          item.id === id
            ? { ...item, quantity: Math.min(20, item.quantity + quantity) }
            : item,
        );
      }
      return [
        ...items,
        {
          id,
          productId: product.id,
          productName: product.name,
          portionSizeMl: portion.sizeInMl,
          quantity,
          unitPriceInPaise,
          selections,
          customizationSelections,
          addOnIds: addOnSelections,
        },
      ];
    });
  }

  function changeCartQuantity(id: string, amount: number) {
    setCartError("");
    setCart((items) =>
      items
        .map((item) =>
          item.id === id
            ? { ...item, quantity: Math.min(20, item.quantity + amount) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function goToCheckout() {
    try {
      sessionStorage.setItem("bb-cloud-kitchen-cart", JSON.stringify(cart));
      router.push("/checkout");
    } catch (error) {
      console.error("Unable to save the cart for checkout.", error);
      setCartError("Your cart could not be saved in this browser. Enable session storage and try again.");
    }
  }

  function openProductDetails(product: MenuProduct) {
    setSelectedProduct(product);
    setDetailPortionSize(product.portions[0]?.sizeInMl ?? 0);
    setDetailQuantity(1);
    setDetailCustomizations({});
    setDetailAddOns([]);
  }

  const selectedDetailPortion = selectedProduct?.portions.find(
    (portion) => portion.sizeInMl === detailPortionSize,
  );

  return (
    <>
      <div className="announcement">
        <span>BB Cloud Kitchen</span>
        <span className="announcement-center">
          Goat bone soup, in Mancherial
        </span>
        <a href="#soups">
          Explore the menu <span aria-hidden="true">↗</span>
        </a>
      </div>

      <header className="site-header">
        <a className="brand" href="#home" aria-label="BB Cloud Kitchen home">
          <span className="brand-mark">BB</span>
          <span className="brand-copy">
            BB <span>Cloud Kitchen</span>
          </span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#home">Home</a>
          <a href="#soups">Our Soups</a>
          <a href="#how-to-order">How to Order</a>
          <a href="#contact">Contact</a>
        </nav>
        <button
          className="cart-button"
          type="button"
          onClick={() => setCartOpen(true)}
          aria-label={`Open cart, ${cartCount} items`}
        >
          Cart <span className="cart-count">{cartCount}</span>
        </button>
      </header>

      <main id="home">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <Eyebrow>
              <span className="eyebrow-dot" /> A SOUP SPECIALIST IN MANCHERIAL
            </Eyebrow>
            <h1 id="hero-title">
              Rich, comforting
              <br />
              goat bone <em>soup.</em>
            </h1>
            <p className="hero-description">
              A focused menu, made for the love of a deeply satisfying bowl.
              Discover BB Cloud Kitchen in Mancherial.
            </p>
            <div className="hero-actions">
              <a className="button button-copper" href="#soups">
                Explore demo menu <span aria-hidden="true">↗</span>
              </a>
              <span className="hero-location">
                <span aria-hidden="true">⌖</span> Mancherial, Telangana
              </span>
            </div>
            <div className="hero-note">
              <span className="note-rule" />
              <span>Goat bone soups, and nothing beyond our specialty.</span>
            </div>
          </div>
          <div className="hero-image-wrap">
            <div
              className="hero-image"
              role="img"
              aria-label="Illustrative soup photo, not a confirmed menu product"
              style={{ backgroundImage: `url("${heroImage}")` }}
            />
            <div className="image-caption">
              <span className="caption-mark">BB</span>
              <span>
                <strong>Demo menu.</strong>
                <br />
                Details awaiting approval.
              </span>
            </div>
            <span className="image-index">
              01 <i /> 01
            </span>
          </div>
        </section>

        <section
          className="featured-section"
          id="soups"
          aria-labelledby="soups-title"
        >
          <div className="section-topline">
            <Eyebrow>THE BB MENU · DEMO</Eyebrow>
            <span className="section-location">MANCHERIAL · TELANGANA</span>
          </div>
          <div className="section-heading">
            <div>
              <h2 id="soups-title">
                Our kind of <em>comfort.</em>
              </h2>
              <p>
                Sample goat bone soup listings only. Products, photos, portions,
                prices and availability need owner approval before launch.
              </p>
            </div>
            <label className="menu-search">
              <span>Find a soup</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search goat bone soups"
                aria-label="Search goat bone soups"
              />
            </label>
          </div>

          {menuStatus === "loading" && (
            <div className="menu-state" role="status" aria-live="polite">
              Loading the sample soup menu…
            </div>
          )}
          {menuStatus === "error" && (
            <div className="menu-state menu-error" role="alert">
              <p>{menuError}</p>
              <button className="button button-copper" onClick={() => void loadMenu()}>
                Try again
              </button>
            </div>
          )}
          {menuStatus === "ready" && visibleProducts.length > 0 && (
            <div className="product-grid" aria-label="Goat bone soup menu">
              {visibleProducts.map((product, index) => {
                const chosenSize =
                  portionByProduct[product.id] ?? product.portions[0]?.sizeInMl;
                const chosenPortion = product.portions.find(
                  (portion) => portion.sizeInMl === chosenSize,
                );
                const available = product.availability === "available";
                return (
                  <article className="product-card" key={product.id}>
                    <div className={`product-image product-image-${index + 1}`}>
                      <div
                        className="product-photo"
                        role="img"
                        aria-label={product.imageAlt}
                        style={{ backgroundImage: `url("${product.imageUrl}")` }}
                      />
                      <span className="product-tag">GOAT BONE SOUP · DEMO</span>
                      <span className="product-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={
                          available
                            ? "availability-badge"
                            : "sold-out-badge"
                        }
                      >
                        {available ? "AVAILABLE · DEMO" : "SOLD OUT · DEMO"}
                      </span>
                    </div>
                    <div className="product-details">
                      <div className="product-title-row">
                        <div>
                          <p className="product-kicker">SAMPLE PRODUCT</p>
                          <button
                            className="product-name-button"
                            type="button"
                            onClick={() => openProductDetails(product)}
                          >
                            {product.name}
                          </button>
                        </div>
                        <span className="product-price">
                          {chosenPortion
                            ? formatPrice(chosenPortion.priceInPaise)
                            : "—"}
                          <br />
                          DEMO PRICE
                        </span>
                      </div>
                      <p className="product-description">{product.description}</p>
                      <div className="card-controls">
                        <label>
                          <span>Portion size</span>
                          <select
                            value={chosenSize}
                            onChange={(event) =>
                              setPortionByProduct((current) => ({
                                ...current,
                                [product.id]: Number(event.target.value),
                              }))
                            }
                            disabled={!available}
                            aria-label={`${product.name} portion size`}
                          >
                            {product.portions.map((portion) => (
                              <option
                                key={portion.sizeInMl}
                                value={portion.sizeInMl}
                              >
                                {portion.sizeInMl} ml ·{" "}
                                {formatPrice(portion.priceInPaise)} demo
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="card-quantity">
                          <span>Quantity</span>
                          <span className="quantity-control">
                            <button
                              type="button"
                              aria-label={`Decrease ${product.name} quantity`}
                              disabled={
                                !available ||
                                (quantityByProduct[product.id] ?? 1) <= 1
                              }
                              onClick={() =>
                                setQuantityByProduct((current) => ({
                                  ...current,
                                  [product.id]: Math.max(
                                    1,
                                    (current[product.id] ?? 1) - 1,
                                  ),
                                }))
                              }
                            >
                              −
                            </button>
                            <span>{quantityByProduct[product.id] ?? 1}</span>
                            <button
                              type="button"
                              aria-label={`Increase ${product.name} quantity`}
                              disabled={
                                !available ||
                                (quantityByProduct[product.id] ?? 1) >= 20
                              }
                              onClick={() =>
                                setQuantityByProduct((current) => ({
                                  ...current,
                                  [product.id]: Math.min(
                                    20,
                                    (current[product.id] ?? 1) + 1,
                                  ),
                                }))
                              }
                            >
                              +
                            </button>
                          </span>
                        </label>
                      </div>
                      <div className="product-actions">
                        <button
                          type="button"
                          className="add-button"
                          disabled={!available || !chosenPortion}
                          onClick={() => {
                            if (chosenPortion) {
                              addToCart(
                                product,
                                chosenPortion,
                                quantityByProduct[product.id] ?? 1,
                              );
                            }
                          }}
                        >
                          {available ? "Add to cart" : "Sold out"}
                          <span aria-hidden="true">+</span>
                        </button>
                        <button
                          type="button"
                          className="details-button"
                          onClick={() => openProductDetails(product)}
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {menuStatus === "ready" && visibleProducts.length === 0 && (
            <div className="menu-state" role="status">
              No demo goat bone soups match “{search}”. Try another search.
            </div>
          )}
          <p className="menu-disclaimer">
            <strong>DEMO MENU — NOT FOR ORDERING.</strong> Product names,
            descriptions, imagery, sample INR prices, portion sizes and the
            sold-out example are placeholders, not confirmed BB Cloud Kitchen
            offerings. Ingredients and preparation times are not provided
            because they have not been confirmed. Replace the sample data in
            the menu configuration before launch. Customizations or add-ons
            will appear only after owner approval.
          </p>
        </section>

        <section className="brand-story" id="about" aria-labelledby="story-title">
          <div className="story-art" aria-hidden="true">
            <div className="story-ring story-ring-one" />
            <div className="story-ring story-ring-two" />
            <span>BB</span>
            <small>SOUP SPECIALIST</small>
          </div>
          <div className="story-copy">
            <Eyebrow>THE BB APPROACH</Eyebrow>
            <h2 id="story-title">
              A clear focus.
              <br />
              <em>A good bowl.</em>
            </h2>
            <p>
              BB Cloud Kitchen is a Mancherial food business with a focused
              menu of goat bone soups. Here you can explore sample menu
              listings, review ordering information and get in touch with the
              kitchen.
            </p>
            <a className="text-link" href="#contact">
              Get in touch <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>

        <section
          className="order-section"
          id="how-to-order"
          aria-labelledby="order-title"
        >
          <div className="order-heading">
            <Eyebrow>THE ORDERING PROCESS</Eyebrow>
            <h2 id="order-title">
              Four simple <em>steps.</em>
            </h2>
            <p>
              The checkout is a development test flow. Server totals are
              recalculated; no payment or real customer order is made.
            </p>
          </div>
          <ol className="steps-list">
            {[
              ["01", "Choose Your Soup", "Explore the goat bone soup menu and choose a portion."],
              ["02", "Review Your Cart", "Check your sample selections and quantities."],
              ["03", "Place Your Test Order", "Try the development-only pickup checkout."],
              ["04", "Check Test Status", "Open the secure link to view your test order status."],
            ].map(([number, title, description]) => (
              <li key={number}>
                <span className="step-number">{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
          <p className="order-status">
            <span /> Development test orders only · no payment or real order.
          </p>
        </section>

        <section className="delivery-band" id="delivery">
          <span className="delivery-icon" aria-hidden="true">
            ⌖
          </span>
          <div>
            <Eyebrow>DELIVERY &amp; PICKUP</Eyebrow>
            <h2>
              Mancherial, <em>when configured.</em>
            </h2>
          </div>
          <p>
            Delivery zones and fees are not configured. Pickup or delivery is
            available only when enabled in the business settings.
          </p>
          <a href="#contact" aria-label="Contact BB Cloud Kitchen about delivery">
            Ask us <span aria-hidden="true">↗</span>
          </a>
        </section>

        <section
          className="contact-section"
          id="contact"
          aria-labelledby="contact-title"
        >
          <div className="contact-intro">
            <Eyebrow>CONTACT BB</Eyebrow>
            <h2 id="contact-title">
              Let’s talk <em>soup.</em>
            </h2>
            <p>
              Questions about the menu or service in Mancherial? Business
              contact details will be published when available.
            </p>
          </div>
          <div className="contact-details">
            <div>
              <span>Location</span>
              <strong>Mancherial, Telangana, India</strong>
            </div>
            <div>
              <span>Phone / WhatsApp</span>
              <strong className="unconfirmed">Business number to be provided</strong>
            </div>
            <div>
              <span>Opening hours</span>
              <strong className="unconfirmed">To be confirmed</strong>
            </div>
            <div>
              <span>Delivery &amp; pickup</span>
              <strong className="unconfirmed">Availability to be confirmed</strong>
            </div>
          </div>
        </section>

        <section className="policy-section" aria-label="Policies and information">
          <div id="privacy">
            <span>Privacy policy</span>
            <p>Privacy information will be published before customer data is collected.</p>
          </div>
          <div id="terms">
            <span>Terms of service</span>
            <p>Terms will be published before online ordering becomes available.</p>
          </div>
          <div id="refund">
            <span>Cancellation &amp; refunds</span>
            <p>Cancellation and refund terms will be confirmed before orders open.</p>
          </div>
          <div>
            <span>Delivery information</span>
            <p>Delivery areas, charges and estimated times are to be confirmed.</p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#home" aria-label="BB Cloud Kitchen home">
          <span className="brand-mark">BB</span>
          <span className="brand-copy">
            BB <span>Cloud Kitchen</span>
          </span>
        </a>
        <span className="footer-note">
          A goat bone soup specialist in Mancherial.
        </span>
        <nav className="footer-links" aria-label="Policies">
          <a href="#privacy">Privacy</a>
          <a href="#terms">Terms</a>
          <a href="#refund">Cancellation &amp; refunds</a>
          <a href="#delivery">Delivery</a>
        </nav>
        <span className="copyright">
          © {new Date().getFullYear()} BB Cloud Kitchen
        </span>
      </footer>

      {selectedProduct && (
        <div
          className="detail-backdrop"
          onClick={() => setSelectedProduct(null)}
        >
          <section
            className="detail-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="detail-heading">
              <div>
                <Eyebrow>DEMO PRODUCT DETAILS</Eyebrow>
                <h2 id="detail-title">{selectedProduct.name}</h2>
              </div>
              <button
                type="button"
                className="close-cart"
                onClick={() => setSelectedProduct(null)}
                aria-label="Close product details"
              >
                ×
              </button>
            </div>
            <div
              className="detail-image"
              role="img"
              aria-label={selectedProduct.imageAlt}
              style={{
                backgroundImage: `url("${selectedProduct.imageUrl}")`,
              }}
            />
            <p className="detail-demo-label">
              SAMPLE LISTING · SAMPLE INR PRICES · NOT A CONFIRMED PRODUCT
            </p>
            <p className="detail-description">{selectedProduct.description}</p>
            <dl className="product-facts">
              <div>
                <dt>Ingredients</dt>
                <dd>
                  {selectedProduct.ingredients.length > 0
                    ? selectedProduct.ingredients.join(", ")
                    : "Awaiting kitchen confirmation"}
                </dd>
              </div>
              {selectedProduct.spiceLevel && (
                <div>
                  <dt>Spice level</dt>
                  <dd>{selectedProduct.spiceLevel}</dd>
                </div>
              )}
              <div>
                <dt>Preparation estimate</dt>
                <dd>
                  {selectedProduct.preparationTimeMinutes === null
                    ? "To be confirmed"
                    : `${selectedProduct.preparationTimeMinutes} minutes`}
                </dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>
                  {selectedProduct.availability === "available"
                    ? "Available · demo status"
                    : "Sold out · demo status"}
                </dd>
              </div>
            </dl>
            <label className="detail-portion">
              <span>Choose portion size</span>
              <select
                value={detailPortionSize}
                onChange={(event) =>
                  setDetailPortionSize(Number(event.target.value))
                }
                disabled={selectedProduct.availability !== "available"}
              >
                {selectedProduct.portions.map((portion) => (
                  <option key={portion.sizeInMl} value={portion.sizeInMl}>
                    {portion.sizeInMl} ml —{" "}
                    {formatPrice(portion.priceInPaise)} demo price
                  </option>
                ))}
              </select>
            </label>
            {(selectedProduct.customizations ?? []).map((customization) => (
              <fieldset className="detail-modifiers" key={customization.id}>
                <legend>{customization.label} · owner-approved options</legend>
                {customization.options.map((option) => (
                  <label key={option.id}>
                    <input
                      type="radio"
                      name={`customization-${customization.id}`}
                      checked={
                        detailCustomizations[customization.id] === option.id
                      }
                      onChange={() =>
                        setDetailCustomizations((current) => ({
                          ...current,
                          [customization.id]: option.id,
                        }))
                      }
                    />
                    {option.name}
                    {option.priceInPaise
                      ? ` (+${formatPrice(option.priceInPaise)})`
                      : ""}
                  </label>
                ))}
              </fieldset>
            ))}
            {(selectedProduct.addOns ?? []).length > 0 && (
              <fieldset className="detail-modifiers">
                <legend>Optional add-ons · owner-approved</legend>
                {(selectedProduct.addOns ?? []).map((addOn) => (
                  <label key={addOn.id}>
                    <input
                      type="checkbox"
                      checked={detailAddOns.includes(addOn.id)}
                      onChange={(event) =>
                        setDetailAddOns((current) =>
                          event.target.checked
                            ? [...current, addOn.id]
                            : current.filter((id) => id !== addOn.id),
                        )
                      }
                    />
                    {addOn.name} (+{formatPrice(addOn.priceInPaise)})
                    {addOn.description ? ` — ${addOn.description}` : ""}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="detail-bottom-row">
              <label className="detail-quantity">
                <span>Quantity</span>
                <span className="quantity-control">
                  <button
                    type="button"
                    onClick={() =>
                      setDetailQuantity((quantity) =>
                        Math.max(1, quantity - 1),
                      )
                    }
                    disabled={detailQuantity <= 1}
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <span>{detailQuantity}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setDetailQuantity((quantity) => Math.min(20, quantity + 1))
                    }
                    disabled={detailQuantity >= 20}
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </span>
              </label>
              <strong className="detail-price">
                {selectedDetailPortion
                  ? formatPrice(
                      selectedDetailPortion.priceInPaise +
                        getCustomizationPrice(
                          selectedProduct.customizations,
                          detailCustomizations,
                        ) +
                        getAddOnPrice(
                          selectedProduct.addOns,
                          detailAddOns,
                        ),
                    )
                  : "—"}
                <small>DEMO PRICE / PORTION</small>
              </strong>
            </div>
            <button
              type="button"
              className="add-button detail-add-button"
              disabled={
                selectedProduct.availability !== "available" ||
                !selectedDetailPortion
              }
              onClick={() => {
                if (selectedDetailPortion) {
                  addToCart(
                    selectedProduct,
                    selectedDetailPortion,
                    detailQuantity,
                    detailCustomizations,
                    detailAddOns,
                  );
                  setSelectedProduct(null);
                }
              }}
            >
              {selectedProduct.availability === "available"
                ? "Add to cart"
                : "Sold out"}
              <span aria-hidden="true">+</span>
            </button>
            <p className="cart-unavailable">
              Demo catalog only. Checkout creates a development test order; no
              payment or real kitchen order is made.
            </p>
          </section>
        </div>
      )}

      {cartOpen && (
        <div className="cart-backdrop" onClick={() => setCartOpen(false)}>
          <section
            className="cart-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="cart-heading">
              <div>
                <Eyebrow>YOUR DEMO SELECTION</Eyebrow>
                <h2 id="cart-title">
                  Your cart <span>({cartCount})</span>
                </h2>
              </div>
              <button
                type="button"
                className="close-cart"
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
              >
                ×
              </button>
            </div>
            {cart.length === 0 ? (
              <div className="empty-cart">
                <span aria-hidden="true">◎</span>
                <h3>Your cart is waiting.</h3>
                <p>Add an available demo soup to see it here.</p>
                <button
                  type="button"
                  className="button button-copper"
                  onClick={() => setCartOpen(false)}
                >
                  Explore soups <span aria-hidden="true">↗</span>
                </button>
              </div>
            ) : (
              <>
                <ul className="cart-items">
                  {cart.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.productName}</strong>
                        <span>{item.portionSizeMl} ml · demo portion</span>
                        {item.selections.map((selection) => (
                          <span key={selection}>{selection}</span>
                        ))}
                        <span>
                          {formatPrice(item.unitPriceInPaise)} demo / item
                        </span>
                      </div>
                      <div className="quantity-control">
                        <button
                          type="button"
                          onClick={() => changeCartQuantity(item.id, -1)}
                          aria-label={`Remove one ${item.productName}`}
                        >
                          −
                        </button>
                        <span>{item.quantity}</span>
                        <button
                          type="button"
                          disabled={item.quantity >= 20}
                          onClick={() => changeCartQuantity(item.id, 1)}
                          aria-label={`Add one ${item.productName}`}
                        >
                          +
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="cart-subtotal">
                  <span>Demo subtotal</span>
                  <strong>{formatPrice(cartSubtotal)}</strong>
                </p>
                <p className="cart-unavailable">
                  Development test data only. No payment is collected, and
                  orders are not sent to the kitchen.
                </p>
                {cartError && <p className="checkout-notice" role="alert">{cartError}</p>}
                <button
                  type="button"
                  className="checkout-button"
                  onClick={goToCheckout}
                >
                  Continue to test checkout
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
