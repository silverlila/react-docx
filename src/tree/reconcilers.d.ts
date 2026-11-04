declare module "react-reconciler-29" {
  type Root = unknown;
  interface Reconciler29 {
    createContainer(
      container: unknown,
      tag: 0,
      hydration: null,
      strict: boolean,
      concurrentOverride: null,
      identifierPrefix: string,
      onRecoverableError: (error: unknown) => void,
      transitionCallbacks: null,
    ): Root;
    updateContainer(element: unknown, root: Root, parent: null, callback: (() => void) | null): void;
  }
  const factory: (hostConfig: object) => Reconciler29;
  export default factory;
}

declare module "react-reconciler-31" {
  type Root = unknown;
  interface Reconciler31 {
    createContainer(
      container: unknown,
      tag: 0 | 1,
      hydration: null,
      strict: boolean,
      concurrentOverride: null,
      identifierPrefix: string,
      onUncaughtError: (error: unknown) => void,
      onCaughtError: (error: unknown) => void,
      onRecoverableError: (error: unknown) => void,
      transitionCallbacks: null,
    ): Root;
    updateContainerSync(element: unknown, root: Root, parent: null, callback: null): void;
    flushSyncWork(): void;
  }
  const factory: (hostConfig: object) => Reconciler31;
  export default factory;
}

declare module "react-reconciler-33" {
  type Root = unknown;
  interface Reconciler33 {
    createContainer(
      container: unknown,
      tag: 0 | 1,
      hydration: null,
      strict: boolean,
      concurrentOverride: null,
      identifierPrefix: string,
      onUncaughtError: (error: unknown) => void,
      onCaughtError: (error: unknown) => void,
      onRecoverableError: (error: unknown) => void,
      onDefaultTransitionIndicator: null,
    ): Root;
    updateContainerSync(element: unknown, root: Root, parent: null, callback: null): void;
    flushSyncWork(): void;
  }
  const factory: (hostConfig: object) => Reconciler33;
  export default factory;
}
