# Developing guide

## Running locally

```sh
npm i
npm run dev
```

## Testing

```sh
npm run clean
npm run build
npm run typecheck
npm run lint
npm run test
```

`npm run lint` includes a Prettier formatting check. To fix formatting:

```sh
npm run format
```

## Deploying

### Building a one-off package

```sh
npm run clean
npm ci
npm pack
```

### Deploying a new version

```sh
npm run release
```

or for alpha release:

```sh
npm run alpha
```
