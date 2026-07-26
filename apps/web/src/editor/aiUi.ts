import {
	ArrowUp,
	Bold,
	Check,
	ChevronUp,
	Code,
	Diff,
	EyeOff,
	FileText,
	Italic,
	MessageCircle,
	MessageCirclePlus,
	Plus,
	Quote,
	RotateCcw,
	Settings2,
	Sigma,
	SlidersHorizontal,
	Sparkles,
	Square,
	TextSelect,
	X,
	createElement,
	type IconNode,
} from 'lucide';
import { aiModelProvider } from '../api/client';

const AI_ICONS: Record<string, IconNode> = {
	'arrow-up': ArrowUp,
	bold: Bold,
	check: Check,
	code: Code,
	'file-text': FileText,
	italic: Italic,
	'message-circle': MessageCircle,
	'message-circle-plus': MessageCirclePlus,
	'settings-2': Settings2,
	'sliders-horizontal': SlidersHorizontal,
	'chevron-up': ChevronUp,
	diff: Diff,
	'eye-off': EyeOff,
	plus: Plus,
	quote: Quote,
	'rotate-ccw': RotateCcw,
	sigma: Sigma,
	sparkles: Sparkles,
	square: Square,
	'text-select': TextSelect,
	x: X,
};

export function paintAiIcons(root: ParentNode): void {
	root.querySelectorAll<HTMLElement>('[data-lucide]').forEach((element) => {
		const node = AI_ICONS[element.dataset.lucide ?? ''];
		if (node) element.replaceWith(createElement(node));
	});
}

const PROVIDER_LOGOS: Record<string, string> = {
	anthropic: '/ai-providers/claude.svg',
	google: '/ai-providers/gemini.svg',
	moonshot: '/ai-providers/kimi.svg',
	openai: '/ai-providers/openai.svg',
	deepseek: '/ai-providers/deepseek.svg',
	xai: '/ai-providers/xai.svg',
	meta: '/ai-providers/meta.svg',
	mistral: '/ai-providers/mistral.svg',
	qwen: '/ai-providers/qwen.svg',
	cohere: '/ai-providers/cohere.svg',
	perplexity: '/ai-providers/perplexity.svg',
	microsoft: '/ai-providers/microsoft.svg',
	amazon: '/ai-providers/amazon.svg',
	zhipu: '/ai-providers/zhipu.svg',
	minimax: '/ai-providers/minimax.svg',
	yi: '/ai-providers/yi.svg',
	baichuan: '/ai-providers/baichuan.svg',
};

export function providerLogoElement(model: string): HTMLElement | undefined {
	const provider = aiModelProvider(model);
	const logo = PROVIDER_LOGOS[provider];
	if (!logo) return undefined;
	const icon = document.createElement('span');
	icon.className = `ai-provider-logo ai-provider-logo-${provider}`;
	icon.style.setProperty('--ai-provider-logo', `url("${logo}")`);
	icon.setAttribute('aria-hidden', 'true');
	return icon;
}

export function populateModelSelect(
	select: HTMLSelectElement,
	models: string[],
	selectedModel: string,
	t: (zhText: string, enText: string) => string,
): void {
	const uniqueModels = [...new Set([...models, selectedModel].map((model) => model.trim()).filter(Boolean))];
	const isSmall = (model: string) => /(?:flash|mini|nano|lite|small)/i.test(model);
	const groups = [
		{ label: t('模型', 'Models'), models: uniqueModels.filter((model) => !isSmall(model)) },
		{ label: t('小型模型', 'Small models'), models: uniqueModels.filter(isSmall) },
	];
	select.replaceChildren();
	for (const group of groups) {
		if (!group.models.length) continue;
		const optgroup = document.createElement('optgroup');
		optgroup.label = group.label;
		optgroup.append(...group.models.map((model) => new Option(model, model, false, model === selectedModel)));
		select.append(optgroup);
	}
}
