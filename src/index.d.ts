/**
 * Public TypeScript surface for bee-ladybug.
 * Runtime is still plain ESM JavaScript in src/*.js.
 */

export const BEE_LADYBUG_VERSION: string;

export const WELL_KNOWN_TYPES: readonly [
    'fps',
    'metric',
    'coord',
    'log',
    'warn',
    'error',
    'state',
    'sys',
    'clear'
];

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type WellKnownType = (typeof WELL_KNOWN_TYPES)[number];

export interface BeePacket {
    id: number;
    type: string;
    payload: Record<string, unknown>;
    wallTime: number;
    simTime: number;
    frame: number;
    source: string;
    level: LogLevel | null;
}

export interface HudEntry {
    value: unknown;
    unit?: string;
    type: string;
}

export interface MetricHistory {
    name: string;
    values: number[];
    min: number;
    max: number;
    avg: number;
    last: number;
}

export interface CoreState {
    version: string;
    visible: boolean;
    frozen: boolean;
    timeScale: number;
    simTime: number;
    frameCount: number;
    coreFps: number;
    logCount: number;
    hud: Record<string, HudEntry>;
    mode: string;
    assistant: string | null;
    assistants: string[];
}

export interface CoreOptions {
    toggleKey?: string;
    slowKey?: string;
    freezeKey?: string;
    slowScale?: number;
    maxLogs?: number;
    historySize?: number;
    mount?: 'auto' | false | HTMLElement;
    ui?: boolean;
    autoAttach?: boolean;
    autoStart?: boolean;
    overlay?: Record<string, unknown>;
}

export const CORE_DEFAULTS: Required<Omit<CoreOptions, 'overlay' | 'mount'>> & {
    mount: 'auto';
};

export interface AssistantSnapshot {
    question: string;
    version: string;
    state: CoreState;
    hud: Record<string, HudEntry>;
    logs: Array<{
        type: string;
        level: LogLevel | null;
        source: string;
        message: string;
        frame: number;
    }>;
    history: {
        name: string;
        min: number;
        max: number;
        avg: number;
        last: number;
        samples: number[];
    };
}

export interface AssistantProvider {
    name?: string;
    complete(input: { question: string; snapshot: AssistantSnapshot }): unknown;
}

export function formatSimTime(ms: number): string;

export class BeeLadybugCore {
    readonly version: string;
    toggleKey: string;
    slowKey: string;
    freezeKey: string;
    slowScale: number;
    maxLogs: number;
    historySize: number;
    visible: boolean;
    frozen: boolean;
    timeScale: number;
    simTime: number;
    frameCount: number;
    coreFps: number;
    ui: UIOverlay | null;

    constructor(options?: CoreOptions);
    sendData(type: string, payload?: unknown): BeePacket | null;
    subscribe(handler: (packet: BeePacket) => void): () => void;
    start(): this;
    stop(): this;
    attach(): this;
    detach(): this;
    destroy(): this;
    show(): this;
    hide(): this;
    toggle(): this;
    freeze(): this;
    unfreeze(): this;
    toggleFreeze(): this;
    setTimeScale(scale: number): this;
    applySlowMo(): this;
    restoreRealtime(): this;
    getState(): CoreState;
    getLogs(): BeePacket[];
    getHistory(name: string): MetricHistory;
    getPrimaryHistory(): MetricHistory;
    getHud(): Record<string, HudEntry>;
    getLatest(type: string): BeePacket | null;
    readonly hasAssistant: boolean;
    readonly assistantBusy: boolean;
    getAssistants(): string[];
    registerAssistant(provider: AssistantProvider): this;
    setActiveAssistant(name: string): this;
    setAssistant(provider: AssistantProvider): this;
    clearAssistant(name?: string): this;
    ask(question?: string): Promise<string | null>;
}

export class UIOverlay {
    core: BeeLadybugCore | null;
    constructor(core: BeeLadybugCore, options?: Record<string, unknown>);
    mount(target?: 'auto' | HTMLElement): this;
    unmount(): this;
    destroy(): this;
    setVisible(visible: boolean): this;
    onPacket(packet: BeePacket): void;
    onClear(channel?: string): void;
    render(): void;
}

export interface CanvasEntity {
    name?: string;
    label?: string;
    id?: string | number;
    role?: string;
    primary?: boolean;
    x?: number;
    y?: number;
    worldX?: number;
    worldY?: number;
    width?: number;
    height?: number;
    w?: number;
    h?: number;
    active?: boolean;
    colliding?: boolean;
    [key: string]: unknown;
}

export interface CanvasAdapterOptions {
    canvas?: HTMLCanvasElement | null;
    entities?: CanvasEntity[];
    overlay?: boolean;
    computeCollisions?: boolean;
    autoPump?: boolean;
    colorActive?: string;
    colorColliding?: string;
    colorInactive?: string;
    source?: string;
}

export const CANVAS_ADAPTER_DEFAULTS: Required<
    Omit<CanvasAdapterOptions, 'canvas' | 'entities'>
>;

export class CanvasAdapter {
    core: BeeLadybugCore | null;
    canvas: HTMLCanvasElement | null;
    entities: CanvasEntity[];
    overlayEnabled: boolean;
    computeCollisions: boolean;
    autoPump: boolean;
    frozen: boolean;
    timeScale: number;
    constructor(core: BeeLadybugCore, options?: CanvasAdapterOptions);
    attach(): this;
    detach(): this;
    startAutoPump(): this;
    setCanvas(canvas: HTMLCanvasElement | null): this;
    setEntities(entities: CanvasEntity[]): this;
    pump(ctx?: CanvasRenderingContext2D): this;
}

export interface WebDOMAdapterOptions {
    root?: ParentNode | null;
    overlay?: boolean;
    autoTick?: boolean;
    watch?: string[];
    source?: string;
    colorHover?: string;
    colorWatch?: string;
    colorMargin?: string;
    colorPadding?: string;
    colorContent?: string;
}

export const WEB_DOM_ADAPTER_DEFAULTS: Required<Omit<WebDOMAdapterOptions, 'root'>>;

export class WebDOMAdapter {
    core: BeeLadybugCore | null;
    root: ParentNode | null;
    overlayEnabled: boolean;
    autoTick: boolean;
    watch: string[];
    frozen: boolean;
    timeScale: number;
    hover: Element | null;
    constructor(core: BeeLadybugCore, options?: WebDOMAdapterOptions);
    attach(): this;
    detach(): this;
    setRoot(root: ParentNode | null): this;
    pump(): this;
}

export type PythonBridgeStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface PythonBridgeOptions {
    url?: string;
    autoReconnect?: boolean;
    reconnectMs?: number;
    source?: string;
}

export const PYTHON_BRIDGE_DEFAULTS: Required<PythonBridgeOptions>;

export class PythonBridge {
    core: BeeLadybugCore | null;
    url: string;
    autoReconnect: boolean;
    reconnectMs: number;
    source: string;
    status: PythonBridgeStatus;
    readonly connected: boolean;
    constructor(core: BeeLadybugCore, options?: PythonBridgeOptions);
    connect(url?: string): this;
    disconnect(): this;
    ingest(raw: unknown): this;
}
