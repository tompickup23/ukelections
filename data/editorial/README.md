# Editorial register

The empty register is deliberate: automated forecasts, election records, year
hubs and release notes are not reviewed news articles.

Before adding an entry, create its standalone `src/pages/news/<slug>/index.astro`
article. Verify its primary sources, visible byline and author page, corrections
route, canonical URL and original first-publication timestamp. Keep `NewsArticle`
schema consistent with the visible article and this register. Include the route
in the main sitemap. Record genuine substantive updates with an explanation;
never replace the first-publication timestamp with a polling date or build date.
Only articles first published within 48 hours enter the News sitemap. A nightly
rebuild is needed to age old entries out. Registry validation is a technical gate,
not a substitute for factual editorial review. Publication remains a separate
approval decision. These steps do not guarantee inclusion in Google News.
