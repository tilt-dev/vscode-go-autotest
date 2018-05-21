node_modules: package.json
	npm install

test-local: src test node_modules
	node_modules/.bin/tsc
	npm run lint
	npm test

test-docker: src test/* package.json
	docker build -f Dockerfile.test .
