# Text category navigation visual review

Approved scope: replace POS sale-category icon tiles with text-only rounded rectangles; selected category uses a dark background and white text. All products are grouped under category headings. Clicking a category scrolls the existing product list; scrolling tracks the active category.

Reviewed desktop 1440×900, tablet 1024×768, portrait 820×1180 and mobile 390×844 screenshots, plus a multi-category tablet example with horizontal navigation. Product cards retain their existing V5 design. The catalog scrolls independently below its navigation so category buttons remain available. The last category fills the remaining viewport and can align at the top.

Seven visual references intentionally change because the shorter category navigation and new headings move the menu content, including behind open controls/modals. Checkout crops in menu-desktop, menu-tablet, populated-cart and payment-dropdown were compared to the pre-change Git references and are pixel-identical. No shared/global CSS was changed.

Automated real API coverage: grouped item retention, category jumps, scroll tracking, last-category alignment, horizontal visibility, dark/white selected style, search, no results, live refresh preserving scroll, and four viewport sizes. Existing modifier and checkout/backend tests remain in the full release gate.
