// @flow
import type {LanguageViewModelType} from "../misc/LanguageViewModel"
import {lang, LanguageViewModel} from "../misc/LanguageViewModel"
import {asyncImport, downcast} from "../api/common/utils/Utils"
import {search} from "../search/Search"
import stream from "mithril/stream/stream.js"
// import {module as replaced} from "@hot"

export type FaqEntry = {
	id: string,
	title: string,
	text: string,
	tags: string
}

type Translation = {
	code: string,
	keys: {[string]: string}
}
const FAQ_PREFIX = "faq."
const MARKDOWN_SUFFIX = "_markdown"


class FaqModel {
	_list: Array<FaqEntry>;
	searchQuery: Stream<string>;
	searchResult: FaqEntry[];
	_currentLanguageCode: string;
	_faqLanguages: LanguageViewModelType;

	constructor() {
		this.searchQuery = stream("")
		this.searchQuery.map(query => {
			this._search(query)
		})

	}


	init(): Promise<void> {
		return Promise.all([
			this.fetchFAQ("en"),
			this.fetchFAQ(lang.code)
		]).spread((defaultTranslations, currentLanguageTranslations) => {
				const faqLanguageViewModel = new LanguageViewModel()
				faqLanguageViewModel.initWithTranslations(lang.code, lang.languageTag, defaultTranslations, currentLanguageTranslations)
				this._faqLanguages = faqLanguageViewModel
			}
		)
	}

	fetchFAQ(langCode: string): Promise<Translation> {
		return asyncImport(typeof module
		!== "undefined" ? module.id : __moduleName, `${env.rootPathPrefix}src/support/faq/${langCode}.js`)
			.then(translations => {
				return translations
				// this.code = lang.code
			})
	}

	getList(): Array<FaqEntry> {
		if (this._list == null || this._currentLanguageCode != lang.code) {
			this._currentLanguageCode = lang.code
			const faqNames = Object.keys(this._faqLanguages.fallback.keys)
			this._list = faqNames.filter(key => key.startsWith(FAQ_PREFIX) && key.endsWith(MARKDOWN_SUFFIX))
			                     .map((titleKey: string) => titleKey.substring(FAQ_PREFIX.length, titleKey.indexOf(MARKDOWN_SUFFIX)))
			                     .map((name: string) => this.createFAQ(name))
		}
		return this._list
	}

	_search(query: string) {
		if (query.trim() == "") {
			this.searchResult = []
		} else {
			this.searchResult = search(query, this.getList(), ['tags', 'title', 'text'], true);
		}
	}

	createFAQ(id: string): FaqEntry {
		return {
			id: id,
			title: this._faqLanguages.get(downcast(`faq.${id}_title`)),
			text: this._faqLanguages.get(downcast(`faq.${id}_markdown`)),
			tags: this.getTags(`faq.${id}_tags`),
		}
	}


	getTags(id: string): string {
		try {
			return this._faqLanguages.get(downcast(id))
		} catch (e) {
			return ""
		}
	}

}


export const faq = new FaqModel()