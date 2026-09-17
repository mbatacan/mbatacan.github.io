.DEFAULT_GOAL := run

.PHONY: run dev build preview

run: build preview ## Build the site and serve it locally so you can look at your changes

dev: ## Start the live-reloading dev server
	npm run dev

build: ## Build the static site into dist/
	npm run build

preview: ## Serve the built dist/ locally
	npm run preview
