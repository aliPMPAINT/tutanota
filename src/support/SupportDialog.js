//@flow


import {Dialog} from "../gui/base/Dialog"
import type {DialogHeaderBarAttrs} from "../gui/base/DialogHeaderBar"
import type {ButtonAttrs} from "../gui/base/ButtonN"
import {ButtonN, ButtonType} from "../gui/base/ButtonN"
import {lang} from "../misc/LanguageViewModel"
import type {TextFieldAttrs} from "../gui/base/TextFieldN"
import {TextFieldN} from "../gui/base/TextFieldN"
import m from "mithril"
import stream from "mithril/stream/stream.js"
import {assertMainOrNode} from "../api/Env"
import {faq} from "./FaqModel"
import {asyncImport} from "../api/common/utils/Utils"


assertMainOrNode()

export function showSupportDialog() {

	const closeButton: ButtonAttrs = {
		label: "close_alt",
		type: ButtonType.Secondary,
		click: () => {
			searchValue("")
			faq.searchResult = []
			dialog.close()
		}
	}


	const header: DialogHeaderBarAttrs = {
		left: [closeButton],
		//right?: Array<ButtonAttrs>,
		middle: () => lang.get("supportMenu_label")
	}

	const searchValue = stream("")

	const searchInputField: TextFieldAttrs = {
		label: () => lang.get("describeProblem_msg"),
		oninput: (value, inputElement) => {
			faq._search(searchValue())
		}
		,
		value: searchValue
	}

	const contactSupport: ButtonAttrs = {
		label: () => "Contact support",
		type: ButtonType.Secondary,
		click: () => {
			asyncImport(typeof module !== "undefined" ?
				module.id : __moduleName, `${env.rootPathPrefix}src/mail/MailEditor.js`)
				.then(mailEditorModule => mailEditorModule.MailEditor.writeSupportMail())
		}
	}

	const
		child: Component = {
			view: () => {
				const displayElements = [
					m(".pt"),
					m(".h1 .text-center", lang.get("howCanWeHelp_title")),
				]
				displayElements.push(m(TextFieldN, searchInputField))
				displayElements.push(m(".pt"))
				faq.searchResult.forEach((value) => {
					displayElements.push(m(".b", m.trust(value.title)))
					//showOptions.push(m(".flex-start", value.tags.split(",").map(tag => m(Badge, {classes: ".badge-normal.mr-s"}, tag.trim()))))
					displayElements.push(m(".flex-start.ml-negative-bubble", value.tags.split(",").filter((tag => tag
						!== "")).map(tag => m(".bubble.plr-button", m.trust(tag.trim())))))
					displayElements.push(m(".list-header", m.trust(value.text)))
					displayElements.push(m(".pb"))
				})
				if (searchValue()) {
					displayElements.push(m(ButtonN, contactSupport))
					displayElements.push(m(".pb"))
				}
				return displayElements
			}
		}

	if (!faq._faqLanguages || faq._currentLanguageCode !== lang.code) {
		faq.init().then(() => {
			faq.getList()
		})
	}

	const dialog = Dialog.largeDialog(
		header,
		child
	)
	dialog.show()

}