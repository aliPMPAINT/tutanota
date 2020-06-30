// @flow
import {Dialog} from "../gui/base/Dialog"
import type {TextFieldAttrs} from "../gui/base/TextFieldN"
import {Type} from "../gui/base/TextFieldN"
import type {Language, TranslationKey} from "../misc/LanguageViewModel"
import {_getSubstitutedLanguageCode, getAvailableLanguageCode, lang, languages} from "../misc/LanguageViewModel"
import {formatStorageSize} from "../misc/Formatter"
import type {ConversationTypeEnum} from "../api/common/TutanotaConstants"
import {
	ALLOWED_IMAGE_FORMATS,
	ConversationType,
	FeatureType,
	MAX_ATTACHMENT_SIZE,
	OperationType,
	ReplyType
} from "../api/common/TutanotaConstants"
import {animations, height, opacity} from "../gui/animation/Animations"
import {load, setup, update} from "../api/main/Entity"
import {worker} from "../api/main/WorkerClient"
import type {Suggestion} from "../gui/base/BubbleTextField"
import {Bubble} from "../gui/base/BubbleTextField"
import type {RecipientInfo} from "../api/common/RecipientInfo"
import {isExternal} from "../api/common/RecipientInfo"
import {
	AccessBlockedError,
	ConnectionError,
	LockedError,
	NotAuthorizedError,
	NotFoundError,
	PreconditionFailedError,
	TooManyRequestsError
} from "../api/common/error/RestError"
import {UserError} from "../api/common/error/UserError"
import {RecipientsNotFoundError} from "../api/common/error/RecipientsNotFoundError"
import {assertMainOrNode, Mode} from "../api/Env"
import {PasswordIndicator} from "../gui/base/PasswordIndicator"
import {getPasswordStrength} from "../misc/PasswordUtils"
import {debounce, downcast, neverNull} from "../api/common/utils/Utils"
import {
	createNewContact,
	createRecipientInfo,
	getDefaultSender,
	getDisplayText,
	getEmailSignature,
	getEnabledMailAddressesWithUser,
	getMailboxName,
	getSenderName,
	parseMailtoUrl,
	replaceCidsWithInlineImages,
	replaceInlineImagesWithCids,
	resolveRecipientInfo
} from "./MailUtils"
import {fileController} from "../file/FileController"
import {contains, findAllAndRemove, remove, replace} from "../api/common/utils/ArrayUtils"
import type {File as TutanotaFile} from "../api/entities/tutanota/File"
import {FileTypeRef} from "../api/entities/tutanota/File"
import {ConversationEntryTypeRef} from "../api/entities/tutanota/ConversationEntry"
import type {Mail} from "../api/entities/tutanota/Mail"
import {MailTypeRef} from "../api/entities/tutanota/Mail"
import {ContactEditor} from "../contacts/ContactEditor"
import type {Contact} from "../api/entities/tutanota/Contact"
import {ContactTypeRef} from "../api/entities/tutanota/Contact"
import {isSameId, stringToCustomId} from "../api/common/EntityFunctions"
import {fileApp} from "../native/FileApp"
import {PermissionError} from "../api/common/error/PermissionError"
import {FileNotFoundError} from "../api/common/error/FileNotFoundError"
import {logins} from "../api/main/LoginController"
import {Icons} from "../gui/base/icons/Icons"
import type {MailAddress} from "../api/entities/tutanota/MailAddress"
import {showProgressDialog} from "../gui/base/ProgressDialog"
import type {MailboxDetail} from "./MailModel"
import {locator} from "../api/main/MainLocator"
import {LazyContactListId} from "../contacts/ContactUtils"
import {RecipientNotResolvedError} from "../api/common/error/RecipientNotResolvedError"
import stream from "mithril/stream/stream.js"
import {checkApprovalStatus} from "../misc/ErrorHandlerImpl"
import type {EntityEventsListener} from "../api/main/EventController"
import {isUpdateForTypeRef} from "../api/main/EventController"
import type {ButtonAttrs} from "../gui/base/ButtonN"
import {ButtonColors, ButtonType} from "../gui/base/ButtonN"
import type {DropDownSelectorAttrs} from "../gui/base/DropDownSelectorN"
import {DropDownSelectorN} from "../gui/base/DropDownSelectorN"
import {attachDropdown, createDropdown} from "../gui/base/DropdownN"
import {FileOpenError} from "../api/common/error/FileOpenError"
import {client} from "../misc/ClientDetector"
import {formatPrice} from "../subscription/SubscriptionUtils"
import {showUpgradeWizard} from "../subscription/UpgradeSubscriptionWizard"
import {CustomerPropertiesTypeRef} from "../api/entities/sys/CustomerProperties"
import type {InlineImages} from "./MailViewer"
import {getTimeZone} from "../calendar/CalendarUtils"
import {px, size} from "../gui/size"
import {isMailAddress} from "../misc/FormatValidator"
import {createApprovalMail} from "../api/entities/monitor/ApprovalMail"
import type {EncryptedMailAddress} from "../api/entities/tutanota/EncryptedMailAddress"

assertMainOrNode()

export type Recipient = {name: ?string, address: string, contact?: ?Contact}
export type RecipientList = $ReadOnlyArray<Recipient>
export type Recipients = {to?: RecipientList, cc?: RecipientList, bcc?: RecipientList}

// Because MailAddress does not have contact of the right type (event when renamed on Recipient) MailAddress <: Recipient does not hold
function toRecipient({address, name}: MailAddress): Recipient {
	return {name, address}
}

type EditorAttachment = TutanotaFile | DataFile | FileReference

export class SendMailModel {
	draft: ?Mail;
	_senderAddress: string;
	_selectedNotificationLanguage: string;
	_toRecipients: Array<RecipientInfo>;
	_ccRecipients: Array<RecipientInfo>;
	_bccRecipients: Array<RecipientInfo>;
	_replyTos: Array<RecipientInfo>;
	_mailAddressToPasswordField: Map<string, TextFieldAttrs>;
	_subject: Stream<string>;
	_body: string; // only defined till the editor is initialized
	_conversationType: ConversationTypeEnum;
	_previousMessageId: ?Id; // only needs to be the correct value if this is a new email. if we are editing a draft, conversationType is not used
	_confidentialButtonState: boolean;

	_attachments: Array<TutanotaFile | DataFile | FileReference>; // contains either Files from Tutanota or DataFiles of locally loaded files. these map 1:1 to the _attachmentButtons
	_mailChanged: boolean;
	_previousMail: ?Mail;
	_entityEventReceived: EntityEventsListener;
	_mailboxDetails: MailboxDetail;

	_objectURLs: Array<string>;
	_blockExternalContent: boolean;
	_mentionedInlineImages: Array<string>
	/** HTML elements which correspond to inline images. We need them to check that they are removed/remove them later */
	_inlineImageElements: Array<HTMLElement>

	/**
	 * Creates a new draft message. Invoke initAsResponse or initFromDraft if this message should be a response
	 * to an existing message or edit an existing draft.
	 *
	 */
	constructor(mailboxDetails: MailboxDetail) {
		this._conversationType = ConversationType.NEW
		this._toRecipients = []
		this._ccRecipients = []
		this._bccRecipients = []
		this._replyTos = []
		this._mailAddressToPasswordField = new Map()
		this._attachments = []
		this._mailChanged = false
		this._previousMail = null
		this.draft = null
		this._mailboxDetails = mailboxDetails
		this._objectURLs = []
		this._blockExternalContent = true
		this._mentionedInlineImages = []
		this._inlineImageElements = []
		this.hooks = {}

		let props = logins.getUserController().props

		this._senderAddress = getDefaultSender(this._mailboxDetails)

		let sortedLanguages = languages.slice().sort((a, b) => lang.get(a.textId).localeCompare(lang.get(b.textId)))
		this._selectedNotificationLanguage = getAvailableLanguageCode(props.notificationMailLanguage || lang.code)

		getTemplateLanguages(sortedLanguages)
			.then((filteredLanguages) => {
				if (filteredLanguages.length > 0) {
					const languageCodes = filteredLanguages.map(l => l.code)
					this._selectedNotificationLanguage = _getSubstitutedLanguageCode(props.notificationMailLanguage
						|| lang.code, languageCodes) || languageCodes[0]
					sortedLanguages = filteredLanguages
				}
			})

		this._confidentialButtonState = !props.defaultUnconfidential
		this._subject = stream("")

		this._subject.onUpdate(v => this._mailChanged = true)

		this._entityEventReceived = (updates) => {
			for (let update of updates) {
				this._handleEntityEvent(update)
			}
		}
		this._mailChanged = false
	}


	_focusBodyOnLoad() {
		this._editor.initialized.promise.then(() => {
			this._editor.focus()
		})
	}

	_conversationTypeToTitleTextId(): TranslationKey {
		switch (this._conversationType) {
			case ConversationType.NEW:
				return "newMail_action"
			case ConversationType.REPLY:
				return "reply_action"
			case ConversationType.FORWARD:
				return "forward_action"
			default:
				return "emptyString_msg"
		}
	}

	animate(domElement: HTMLElement, fadein: boolean) {
		let childHeight = domElement.offsetHeight
		return animations.add(domElement, fadein ? height(0, childHeight) : height(childHeight, 0))
		                 .then(() => {
			                 domElement.style.height = ''
		                 })
	}

	getPasswordField(recipientInfo: RecipientInfo): TextFieldAttrs {
		if (!this._mailAddressToPasswordField.has(recipientInfo.mailAddress)) {
			let passwordIndicator = new PasswordIndicator(() => this.getPasswordStrength(recipientInfo))
			let textFieldAttrs = {
				label: () => lang.get("passwordFor_label", {"{1}": recipientInfo.mailAddress}),
				helpLabel: () => m(passwordIndicator),
				value: stream(""),
				type: Type.ExternalPassword
			}
			if (recipientInfo.contact && recipientInfo.contact.presharedPassword) {
				textFieldAttrs.value(recipientInfo.contact.presharedPassword)
			}
			this._mailAddressToPasswordField.set(recipientInfo.mailAddress, textFieldAttrs)
		}
		return neverNull(this._mailAddressToPasswordField.get(recipientInfo.mailAddress))
	}

	getPasswordStrength(recipientInfo: RecipientInfo) {
		let reserved = getEnabledMailAddressesWithUser(this._mailboxDetails, logins.getUserController().userGroupInfo).concat(
			getMailboxName(this._mailboxDetails),
			recipientInfo.mailAddress,
			recipientInfo.name
		)
		return Math.min(100, (getPasswordStrength(this.getPasswordField(recipientInfo).value(), reserved) / 0.8 * 1))
	}

	initAsResponse({
		               previousMail, conversationType, senderMailAddress, recipients, attachments, subject, bodyText, replyTos,
		               addSignature, inlineImages, blockExternalContent
	               }: {
		previousMail: Mail,
		conversationType: ConversationTypeEnum,
		senderMailAddress: string,
		recipients: Recipients,
		attachments: TutanotaFile[],
		subject: string,
		bodyText: string,
		replyTos: EncryptedMailAddress[],
		addSignature: boolean,
		inlineImages?: ?Promise<InlineImages>,
		blockExternalContent: boolean
	}): Promise<void> {
		this._blockExternalContent = blockExternalContent
		if (addSignature) {
			bodyText = "<br/><br/><br/>" + bodyText
			let signature = getEmailSignature()
			if (logins.getUserController().isInternalUser() && signature) {
				bodyText = signature + bodyText
			}
		}
		if (conversationType === ConversationType.REPLY) {
			this.dialog.setFocusOnLoadFunction(() => this._focusBodyOnLoad())
		}
		let previousMessageId: ?string = null
		return load(ConversationEntryTypeRef, previousMail.conversationEntry)
			.then(ce => {
				previousMessageId = ce.messageId
			})
			.catch(NotFoundError, e => {
				console.log("could not load conversation entry", e);
			})
			.then(() => {
				// We don't want to wait for the editor to be initialized, otherwise it will never be shown
				this._setMailData(previousMail, previousMail.confidential, conversationType, previousMessageId, senderMailAddress,
					recipients, attachments, subject, bodyText, replyTos)
				    .then(() => this._replaceInlineImages(inlineImages))
			})
	}

	initWithTemplate(recipients: Recipients, subject: string, bodyText: string, confidential: ?boolean, senderMailAddress?: string): Promise<void> {
		if (recipients.to && recipients.to.length) {
			this.dialog.setFocusOnLoadFunction(() => this._focusBodyOnLoad())
		}

		const sender = senderMailAddress ? senderMailAddress : this._senderAddress.selectedValue()

		this._setMailData(null, confidential, ConversationType.NEW, null, sender, recipients, [], subject, bodyText, [])
		return Promise.resolve()
	}

	initWithMailtoUrl(mailtoUrl: string, confidential: boolean): Promise<void> {
		const result = parseMailtoUrl(mailtoUrl)

		let bodyText = result.body
		const signature = getEmailSignature()
		if (logins.getUserController().isInternalUser() && signature) {
			bodyText = bodyText + signature
		}
		const {to, cc, bcc} = result
		this._setMailData(null, confidential, ConversationType.NEW, null, this._senderAddress.selectedValue(), {to, cc, bcc}, [],
			result.subject, bodyText, [])
		return Promise.resolve()
	}

	initFromDraft({draftMail, attachments, bodyText, inlineImages, blockExternalContent}: {
		draftMail: Mail,
		attachments: TutanotaFile[],
		bodyText: string,
		blockExternalContent: boolean,
		inlineImages?: Promise<InlineImages>
	}): Promise<void> {
		let conversationType: ConversationTypeEnum = ConversationType.NEW
		let previousMessageId: ?string = null
		let previousMail: ?Mail = null
		this.draft = draftMail
		this._blockExternalContent = blockExternalContent

		return load(ConversationEntryTypeRef, draftMail.conversationEntry).then(ce => {
			conversationType = downcast(ce.conversationType)
			if (ce.previous) {
				return load(ConversationEntryTypeRef, ce.previous).then(previousCe => {
					previousMessageId = previousCe.messageId
					if (previousCe.mail) {
						return load(MailTypeRef, previousCe.mail).then(mail => {
							previousMail = mail
						})
					}
				}).catch(NotFoundError, e => {
					// ignore
				})
			}
		}).then(() => {
			const {confidential, sender, toRecipients, ccRecipients, bccRecipients, subject, replyTos} = draftMail
			const recipients: Recipients = {
				to: toRecipients.map(toRecipient),
				cc: ccRecipients.map(toRecipient),
				bcc: bccRecipients.map(toRecipient),
			}
			// We don't want to wait for the editor to be initialized, otherwise it will never be shown
			this._setMailData(previousMail, confidential, conversationType, previousMessageId, sender.address, recipients, attachments,
				subject, bodyText, replyTos)
			    .then(() => this._replaceInlineImages(inlineImages))
		})
	}

	_setMailData(previousMail: ?Mail, confidential: ?boolean, conversationType: ConversationTypeEnum, previousMessageId: ?string, senderMailAddress: string,
	             recipients: Recipients, attachments: TutanotaFile[], subject: string,
	             body: string, replyTos: EncryptedMailAddress[]): Promise<void> {
		this._previousMail = previousMail
		this._conversationType = conversationType
		this._previousMessageId = previousMessageId
		if (confidential != null) {
			this._confidentialButtonState = confidential
		}
		this._senderAddress.selectedValue(senderMailAddress)
		this._subject.setValue(subject)
		this._attachments = []
		this._tempBody = body

		this.attachFiles(((attachments: any): Array<TutanotaFile | DataFile | FileReference>))

		// call this async because the editor is not initialized before this mail editor dialog is shown
		const promise = this._editor.initialized.promise.then(() => {
			if (this._editor.getHTML() !== body) {
				this._editor.setHTML(this._tempBody)
				this._mailChanged = false
				// Add mutation observer to remove attachments when corresponding DOM element is removed
				this._observeEditorMutations()
			}
			this._tempBody = null
		})

		if (previousMail && previousMail.restrictions && previousMail.restrictions.participantGroupInfos.length > 0) {
			this._toRecipients.textField._injectionsRight = null
			this._toRecipients.textField.setDisabled()
		}

		const {to = [], cc = [], bcc = []} = recipients
		this._toRecipients.bubbles = to.filter(r => isMailAddress(r.address, false))
		                               .map(r => this.createBubble(r.name, r.address, r.contact))
		this._ccRecipients.bubbles = cc.filter(r => isMailAddress(r.address, false))
		                               .map(r => this.createBubble(r.name, r.address, r.contact))
		this._bccRecipients.bubbles = bcc.filter(r => isMailAddress(r.address, false))
		                                 .map(r => this.createBubble(r.name, r.address, r.contact))
		this._replyTos = replyTos.map(ema => createRecipientInfo(ema.address, ema.name, null, true))
		this._mailChanged = false
		return promise
	}

	_replaceInlineImages(inlineImages: ?Promise<InlineImages>): void {
		if (inlineImages) {
			inlineImages.then((loadedInlineImages) => {
				Object.keys(loadedInlineImages).forEach((key) => {
					const {file} = loadedInlineImages[key]
					if (!this._attachments.includes(file)) this._attachments.push(file)
					m.redraw()
				})
				this._editor.initialized.promise.then(() => {
					this._inlineImageElements = replaceCidsWithInlineImages(this._editor.getDOM(), loadedInlineImages, (file, event, dom) => {
						createDropdown(() => [
							{
								label: "download_action",
								click: () => {
									fileController.downloadAndOpen(file, true)
									              .catch(FileOpenError, () => Dialog.error("canNotOpenFileOnDevice_msg"))
								},
								type: ButtonType.Dropdown
							}
						])(downcast(event), dom)
					})
				})
			})
		}
	}

	show() {
		locator.eventController.addEntityListener(this._entityEventReceived)
		this.dialog.show()
	}


	_close() {
		locator.eventController.removeEntityListener(this._entityEventReceived)
		this.dialog.close()
	}

	_showFileChooserForAttachments(boundingRect: ClientRect, fileTypes?: Array<string>): Promise<?$ReadOnlyArray<FileReference | DataFile>> {
		if (env.mode === Mode.App) {
			return fileApp
				.openFileChooser(boundingRect)
				.then(files => {
					this.attachFiles((files: any))
					m.redraw()
					return files
				})
				.catch(PermissionError, () => {
					Dialog.error("fileAccessDeniedMobile_msg")
				})
				.catch(FileNotFoundError, () => {
					Dialog.error("couldNotAttachFile_msg")
				})
		} else {
			return fileController.showFileChooser(true, fileTypes).then(files => {
				this.attachFiles((files: any))
				m.redraw()
				return files
			})
		}
	}

	attachFiles(files: Array<TutanotaFile | DataFile | FileReference>) {
		let totalSize = 0
		this._attachments.forEach(file => {
			totalSize += Number(file.size)
		})
		let tooBigFiles = [];
		files.forEach(file => {
			if (totalSize + Number(file.size) > MAX_ATTACHMENT_SIZE) {
				tooBigFiles.push(file.name)
			} else {
				totalSize += Number(file.size)
				this._attachments.push(file)
			}
		})
		if (tooBigFiles.length > 0) {
			Dialog.error(() => lang.get("tooBigAttachment_msg") + tooBigFiles.join(", "));
		}
		this._mailChanged = true
		m.redraw()
	}

	_getAttachmentButtons(): Array<ButtonAttrs> {
		return this
			._attachments
			// Only show file buttons which do not correspond to inline images in HTML
			.filter((item) => this._mentionedInlineImages.includes(item.cid) === false)
			.map(file => {
				let lazyButtonAttrs: ButtonAttrs[] = []

				lazyButtonAttrs.push({
					label: "download_action",
					type: ButtonType.Secondary,
					click: () => {
						if (file._type === 'FileReference') {
							return fileApp.open(downcast(file))
							              .catch(FileOpenError, () => Dialog.error("canNotOpenFileOnDevice_msg"))
						} else if (file._type === "DataFile") {
							return fileController.open(downcast(file))
						} else {
							fileController.downloadAndOpen(((file: any): TutanotaFile), true)
							              .catch(FileOpenError, () => Dialog.error("canNotOpenFileOnDevice_msg"))
						}
					},
				})

				lazyButtonAttrs.push({
					label: "remove_action",
					type: ButtonType.Secondary,
					click: () => {
						remove(this._attachments, file)
						if (file.cid) {
							const imageElement = this._inlineImageElements.find((e) => e.getAttribute("cid") === file.cid)
							imageElement && imageElement.remove()
						}
						this._mailChanged = true
						m.redraw()
					}
				})

				return attachDropdown({
					label: () => file.name,
					icon: () => Icons.Attachment,
					type: ButtonType.Bubble,
					staticRightText: "(" + formatStorageSize(Number(file.size)) + ")",
					colors: ButtonColors.Elevated,
				}, () => lazyButtonAttrs)
			})
	}

	_onAttachImageClicked(ev: Event) {
		this._showFileChooserForAttachments((ev.target: any).getBoundingClientRect(), ALLOWED_IMAGE_FORMATS)
		    .then((files) => {
			    files && files.forEach((f) => {
				    // Let'S assume it's DataFile for now... Editor bar is available for apps but image button is not
				    const dataFile: DataFile = downcast(f)
				    const cid = Math.random().toString(30).substring(2)
				    f.cid = cid
				    const blob = new Blob([dataFile.data], {type: f.mimeType})
				    let objectUrl = URL.createObjectURL(blob)
				    this._objectURLs.push(objectUrl)
				    this._inlineImageElements.push(this._editor.insertImage(objectUrl, {cid, style: 'max-width: 100%'}))
			    })
		    })
	}

	/**
	 * Saves the draft.
	 * @param saveAttachments True if also the attachments shall be saved, false otherwise.
	 * @returns {Promise} When finished.
	 * @throws FileNotFoundError when one of the attachments could not be opened
	 * @throws PreconditionFailedError when the draft is locked
	 */
	saveDraft(saveAttachments: boolean, showProgress: boolean): Promise<void> {
		let attachments = (saveAttachments) ? this._attachments : null
		let senderName = getSenderName(this._mailboxDetails)
		let to = this._toRecipients.bubbles.map(bubble => bubble.entity)
		let cc = this._ccRecipients.bubbles.map(bubble => bubble.entity)
		let bcc = this._bccRecipients.bubbles.map(bubble => bubble.entity)

		// _tempBody is til the editor is initialized. It might not be the case when
		// assigning a mail to another user because editor is not shown and we cannot
		// wait for the editor to be initialized.
		const body = this._tempBody == null ? replaceInlineImagesWithCids(this._editor.getDOM()).innerHTML : this._tempBody
		let promise = null
		const createMailDraft = () => worker.createMailDraft(this._subject.value(), body,
			this._senderAddress.selectedValue(), senderName, to, cc, bcc, this._conversationType, this._previousMessageId,
			attachments, this._isConfidential(), this._replyTos)
		const draft = this.draft
		if (draft != null) {
			promise = worker.updateMailDraft(this._subject.value(), body, this._senderAddress.selectedValue(),
				senderName, to, cc, bcc, attachments, this._isConfidential(), draft)
			                .catch(LockedError, e => Dialog.error("operationStillActive_msg"))
			                .catch(NotFoundError, e => {
				                console.log("draft has been deleted, creating new one")
				                return createMailDraft()
			                })
		} else {
			promise = createMailDraft()
		}

		promise = promise.then(draft => {
			this.draft = draft
			return Promise.map(draft.attachments, fileId => load(FileTypeRef, fileId)).then(attachments => {
				this._attachments = [] // attachFiles will push to existing files but we want to overwrite them
				this.attachFiles(attachments)
				this._mailChanged = false
			})
		})

		if (showProgress) {
			return showProgressDialog("save_msg", promise)
		} else {
			return promise
		}
	}

	_isConfidential() {
		return this._confidentialButtonState || !this._containsExternalRecipients()
	}

	getConfidentialStateMessage() {
		if (this._isConfidential()) {
			return lang.get('confidentialStatus_msg')
		} else {
			return lang.get('nonConfidentialStatus_msg')
		}
	}

	_containsExternalRecipients() {
		return (this._allRecipients().find(r => isExternal(r)) != null)
	}

	send(showProgress: boolean = true, tooManyRequestsError: TranslationKey = "tooManyMails_msg") {
		return Promise
			.resolve()
			.then(() => {
				this._toRecipients.createBubbles()
				this._ccRecipients.createBubbles()
				this._bccRecipients.createBubbles()

				if (this._toRecipients.textField.value().trim() !== "" ||
					this._ccRecipients.textField.value().trim() !== "" ||
					this._bccRecipients.textField.value().trim() !== "") {
					throw new UserError("invalidRecipients_msg")
				} else if (this._toRecipients.bubbles.length === 0 &&
					this._ccRecipients.bubbles.length === 0 &&
					this._bccRecipients.bubbles.length === 0) {
					throw new UserError("noRecipients_msg")
				}

				let subjectConfirmPromise = Promise.resolve(true)

				if (this._subject.value().trim().length === 0) {
					subjectConfirmPromise = Dialog.confirm("noSubject_msg")
				}
				return subjectConfirmPromise
			})
			.then(confirmed => {
				if (confirmed) {
					let isApprovalMail = false
					let send = this
						._waitForResolvedRecipients() // Resolve all added recipients before trying to send it
						.then((recipients) => {
							if (recipients.length === 1 && recipients[0].mailAddress.toLowerCase().trim() === "approval@tutao.de") {
								isApprovalMail = true
								return recipients
							} else {
								const beforeSaveHook = this.hooks.beforeSave
								if (beforeSaveHook) {
									if (this._tempBody) {
										this._tempBody = beforeSaveHook(this, recipients, this._tempBody)
									} else {
										this._editor.setHTML(beforeSaveHook(this, recipients, this._editor.getHTML()))
									}
								}
								return this.saveDraft(true, false)
								           .return(recipients)
							}
						})
						.then(resolvedRecipients => {
							if (isApprovalMail) {
								let m = createApprovalMail()
								m._id = ["---------c--", stringToCustomId(this._senderAddress.selectedValue())]
								m._ownerGroup = logins.getUserController().user.userGroup.group
								m.text = "Subject: " + this._subject.value() + "<br>" + this._editor.getDOM().innerHTML
								return setup(m._id[0], m)
									.catch(NotAuthorizedError, e => console.log("not authorized for approval message"))
									.then(() => this._close())
							} else {
								let externalRecipients = resolvedRecipients.filter(r => isExternal(r))
								if (this._confidentialButtonState && externalRecipients.length > 0
									&& externalRecipients.find(r => this.getPasswordField(r).value().trim()
										!== "") == null) {
									throw new UserError("noPreSharedPassword_msg")
								}

								let sendMailConfirm = Promise.resolve(true)
								if (this._confidentialButtonState
									&& externalRecipients.reduce((min, current) =>
										Math.min(min, this.getPasswordStrength(current)), 100) < 80) {
									sendMailConfirm = Dialog.confirm("presharedPasswordNotStrongEnough_msg")
								}

								return sendMailConfirm.then(ok => {
									if (ok) {
										const beforeSentHook = this.hooks.beforeSent
										return this._updateContacts(resolvedRecipients)
										           .then(() => beforeSentHook && beforeSentHook(this, downcast(this._attachments))
											           || ({calendarFileMethods: []}))
										           .then(({calendarFileMethods}) => worker.sendMailDraft(neverNull(this.draft), resolvedRecipients,
											           this._selectedNotificationLanguage(), calendarFileMethods))
										           .then(() => this._updatePreviousMail())
										           .then(() => this._updateExternalLanguage())
										           .then(() => this.hooks.afterSent && this.hooks.afterSent(this))
										           .then(() => this._close())
										           .catch(LockedError, e => Dialog.error("operationStillActive_msg"))
									}
								})
							}
						})
						.catch(RecipientNotResolvedError, e => {
							return Dialog.error("tooManyAttempts_msg")
						})
						.catch(RecipientsNotFoundError, e => {
							let invalidRecipients = e.message.join("\n")
							return Dialog.error(() => lang.get("invalidRecipients_msg") + "\n"
								+ invalidRecipients)
						})
						.catch(TooManyRequestsError, e => Dialog.error(tooManyRequestsError))
						.catch(AccessBlockedError, e => {
							// special case: the approval status is set to SpamSender, but the update has not been received yet, so use SpamSender as default
							return checkApprovalStatus(true, "4")
								.then(() => {
									console.log("could not send mail (blocked access)", e)
								})
						})
						.catch(FileNotFoundError, () => Dialog.error("couldNotAttachFile_msg"))
						.catch(PreconditionFailedError, () => Dialog.error("operationStillActive_msg"))

					return showProgress
						? showProgressDialog(this._confidentialButtonState ? "sending_msg" : "sendingUnencrypted_msg", send)
						: send
				}
			})
			.catch(UserError, e => Dialog.error(e.message))
			.catch(e => {
				console.log(typeof e, e)
				throw e
			})
	}

	_updateExternalLanguage() {
		let props = logins.getUserController().props
		if (props.notificationMailLanguage !== this._selectedNotificationLanguage()) {
			props.notificationMailLanguage = this._selectedNotificationLanguage()
			update(props)
		}
	}

	_updatePreviousMail(): Promise<void> {
		if (this._previousMail
		) {
			if (this._previousMail.replyType === ReplyType.NONE && this._conversationType === ConversationType.REPLY) {
				this._previousMail.replyType = ReplyType.REPLY
			} else if (this._previousMail.replyType === ReplyType.NONE
				&& this._conversationType === ConversationType.FORWARD) {
				this._previousMail.replyType = ReplyType.FORWARD
			} else if (this._previousMail.replyType === ReplyType.FORWARD
				&& this._conversationType === ConversationType.REPLY) {
				this._previousMail.replyType = ReplyType.REPLY_FORWARD
			} else if (this._previousMail.replyType === ReplyType.REPLY
				&& this._conversationType === ConversationType.FORWARD) {
				this._previousMail.replyType = ReplyType.REPLY_FORWARD
			} else {
				return Promise.resolve()
			}
			return update(this._previousMail).catch(NotFoundError, e => {
				// ignore
			})
		} else {
			return Promise.resolve();
		}
	}

	_updateContacts(resolvedRecipients: RecipientInfo[]): Promise<any> {
		return Promise.all(resolvedRecipients.map(r => {
			const {contact} = r
			if (contact) {
				if (!contact._id && (!logins.getUserController().props.noAutomaticContacts
					|| (isExternal(r) && this._confidentialButtonState))) {
					if (isExternal(r) && this._confidentialButtonState) {
						contact.presharedPassword = this.getPasswordField(r).value().trim()
					}
					return LazyContactListId.getAsync().then(listId => {
						return setup(listId, contact)
					})
				} else if (contact._id && isExternal(r) && this._confidentialButtonState
					&& contact.presharedPassword !== this.getPasswordField(r).value().trim()) {
					contact.presharedPassword = this.getPasswordField(r).value().trim()
					return update(contact)
				} else {
					return Promise.resolve()
				}
			} else {
				return Promise.resolve()
			}
		}))
	}

	_allRecipients(): Array<RecipientInfo> {
		return this._toRecipients.bubbles.map(b => b.entity)
		           .concat(this._ccRecipients.bubbles.map(b => b.entity))
		           .concat(this._bccRecipients.bubbles.map(b => b.entity))
	}

	/**
	 * Makes sure the recipient type and contact are resolved.
	 */
	_waitForResolvedRecipients(): Promise<RecipientInfo[]> {
		return Promise.all(this._allRecipients().map(recipientInfo => {
			return resolveRecipientInfo(recipientInfo).then(recipientInfo => {
				if (recipientInfo.resolveContactPromise) {
					return recipientInfo.resolveContactPromise.return(recipientInfo)
				} else {
					return recipientInfo
				}
			})
		})).catch(TooManyRequestsError, e => {
			throw new RecipientNotResolvedError()
		})
	}

	/**
	 * @param name If null the name is taken from the contact if a contact is found for the email addrss
	 */
	createBubble(name: ?string, mailAddress: string, contact: ?Contact): Bubble<RecipientInfo> {
		this._mailChanged = true
		let recipientInfo = createRecipientInfo(mailAddress, name, contact, false)
		let bubbleWrapper = {}
		bubbleWrapper.buttonAttrs = attachDropdown({
			label: () => getDisplayText(recipientInfo.name, mailAddress, false),
			type: ButtonType.TextBubble,
			isSelected: () => false,
			color: ButtonColors.Elevated
		}, () => {
			if (recipientInfo.resolveContactPromise) {
				return recipientInfo.resolveContactPromise.then(contact => {
					return this._createBubbleContextButtons(recipientInfo.name, mailAddress, contact, () => bubbleWrapper.bubble)
				})
			} else {
				return Promise.resolve(this._createBubbleContextButtons(recipientInfo.name, mailAddress, contact, () => bubbleWrapper.bubble))
			}
		}, undefined, 250)

		resolveRecipientInfo(recipientInfo)
			.then(() => m.redraw())
			.catch(ConnectionError, e => {
				// we are offline but we want to show the error dialog only when we click on send.
			})
			.catch(TooManyRequestsError, e => {
				Dialog.error("tooManyAttempts_msg")
			})
		bubbleWrapper.bubble = new Bubble(recipientInfo, neverNull(bubbleWrapper.buttonAttrs), mailAddress)
		return bubbleWrapper.bubble
	}

	_createBubbleContextButtons(name: string, mailAddress: string, contact: ? Contact, bubbleResolver: Function): Array<ButtonAttrs | string> {
		let buttonAttrs = [mailAddress]
		if (logins.getUserController().isInternalUser()) {
			if (!logins.isEnabled(FeatureType.DisableContacts)) {
				if (contact && contact._id) { // the contact may be new contact, in this case do not edit it
					buttonAttrs.push({
						label: "editContact_label",
						type: ButtonType.Secondary,
						click: () => new ContactEditor(contact).show()
					})
				} else {
					buttonAttrs.push({
						label: "createContact_action",
						type: ButtonType.Secondary,
						click: () => {
							LazyContactListId.getAsync().then(contactListId => {
								new ContactEditor(createNewContact(mailAddress, name), contactListId, contactElementId => {
									let bubbles = [
										this._toRecipients.bubbles, this._ccRecipients.bubbles, this._bccRecipients.bubbles
									].find(b => contains(b, bubbleResolver()))
									if (bubbles) {
										this._updateBubble(bubbles, bubbleResolver(), [contactListId, contactElementId])
									}
								}).show()
							})
						}
					})
				}
			}
			if (!this._previousMail
				|| !this._previousMail.restrictions
				|| this._previousMail.restrictions.participantGroupInfos.length === 0) {
				buttonAttrs.push({
					label: "remove_action",
					type: ButtonType.Secondary,
					click: () => this._removeBubble(bubbleResolver())
				})
			}
		}

		return buttonAttrs
	}

	_handleEntityEvent(update: EntityUpdateData): void {
		const {operation, instanceId, instanceListId} = update
		if (isUpdateForTypeRef(ContactTypeRef, update)
			&& (operation === OperationType.UPDATE || operation === OperationType.DELETE)) {
			let contactId: IdTuple = [neverNull(instanceListId), instanceId]
			let allBubbleLists = [this._toRecipients.bubbles, this._ccRecipients.bubbles, this._bccRecipients.bubbles]
			allBubbleLists.forEach(bubbles => {
				bubbles.forEach(bubble => {
					if (bubble => bubble.entity.contact && bubble.entity.contact._id
						&& isSameId(bubble.entity.contact._id, contactId)) {
						if (operation === OperationType.UPDATE) {
							this._updateBubble(bubbles, bubble, contactId)
						} else {
							this._removeBubble(bubble)
						}
					}
				})
			})
		}
	}

	_updateBubble(bubbles: Bubble<RecipientInfo> [], oldBubble: Bubble<RecipientInfo>, contactId: IdTuple) {
		this._mailChanged = true
		let emailAddress = oldBubble.entity.mailAddress
		load(ContactTypeRef, contactId).then(updatedContact => {
			if (!updatedContact.mailAddresses.find(ma =>
				ma.address.trim().toLowerCase() === emailAddress.trim().toLowerCase())) {
				// the mail address was removed, so remove the bubble
				remove(bubbles, oldBubble)
			} else {
				let newBubble = this.createBubble(`${updatedContact.firstName} ${updatedContact.lastName}`.trim(), emailAddress, updatedContact)
				replace(bubbles, oldBubble, newBubble)
				if (updatedContact.presharedPassword && this._mailAddressToPasswordField.has(emailAddress)) {
					neverNull(this._mailAddressToPasswordField.get(emailAddress))
						.value(updatedContact.presharedPassword || "")
				}
			}
		})
	}

	_removeBubble(bubble: Bubble<RecipientInfo>) {
		this._mailChanged = true
		let bubbles = [
			this._toRecipients.bubbles, this._ccRecipients.bubbles, this._bccRecipients.bubbles
		].find(b => contains(b, bubble))
		if (bubbles) {
			remove(bubbles, bubble)
		}
	}

	_languageDropDown(langs: Array<Language>): Children {
		const languageDropDownAttrs: DropDownSelectorAttrs<string> = {
			label: "notificationMailLanguage_label",
			items: langs.map(language => {
				return {name: lang.get(language.textId), value: language.code}
			}),
			selectedValue: this._selectedNotificationLanguage,
			dropdownWidth: 250
		}
		return m("", (this._confidentialButtonState && this._containsExternalRecipients())
			? m("", {
				oncreate: vnode => animations.add(vnode.dom, opacity(0, 1, false)),
				onbeforeremove: vnode => animations.add(vnode.dom, opacity(1, 0, false))
			}, m(DropDownSelectorN, languageDropDownAttrs))
			: null
		)
	}

	_cleanupInlineAttachments = debounce(50, () => {
		// Previously we replied on subtree option of MutationObserver to receive info when nested child is removed.
		// It works but it doesn't work if the parent of the nested child is removed, we would have to go over each mutation
		// and check each descendant and if it's an image with CID or not.
		// It's easier and faster to just go over each inline image that we know about. It's more bookkeeping but it's easier
		// code which touches less dome.
		//
		// Alternative would be observe the parent of each inline image but that's more complexity and we need to take care of
		// new (just inserted) inline images and also assign listener there.
		// Doing this check instead of relying on mutations also helps with the case when node is removed but inserted again
		// briefly, e.g. if some text is inserted before/after the element, Squire would put it into another diff and this
		// means removal + insertion.
		const elementsToRemove = []
		this._inlineImageElements.forEach((inlineImage) => {
			if (this._domElement && !this._domElement.contains(inlineImage)) {
				const cid = inlineImage.getAttribute("cid")
				const attachmentIndex = this._attachments.findIndex((a) => a.cid === cid)
				if (attachmentIndex !== -1) {
					this._attachments.splice(attachmentIndex, 1)
					elementsToRemove.push(inlineImage)
					m.redraw()
				}
			}
		})
		findAllAndRemove(this._inlineImageElements, (imageElement) => elementsToRemove.includes(imageElement))
	})

	_observeEditorMutations() {
		new MutationObserver(this._cleanupInlineAttachments)
			.observe(this._editor.getDOM(), {attributes: false, childList: true, subtree: true})
	}

	static writeSupportMail() {
		locator.mailModel.init().then(() => {
			if (!logins.getUserController().isPremiumAccount()) {
				const message = lang.get("premiumOffer_msg", {"{1}": formatPrice(1, true)})
				const title = lang.get("upgradeReminderTitle_msg")
				Dialog.reminder(title, message, "https://tutanota.com/blog/posts/premium-pro-business").then(confirm => {
					if (confirm) {
						showUpgradeWizard()
					}
				})
				return
			}
			return locator.mailModel.getUserMailboxDetails().then((mailboxDetails) => {
				const editor = new MailEditor(mailboxDetails)
				let signature = "<br><br>--"
				signature += "<br>Client: " + client.getIdentifier()
				signature += "<br>Tutanota version: " + env.versionNumber
				signature += "<br>Time zone: " + getTimeZone()
				signature += "<br>User agent:<br>" + navigator.userAgent
				editor.initWithTemplate({to: [{name: null, address: "premium@tutao.de"}]}, "", signature, true).then(() => {
					editor.show()
				})
			})
		})

	}

	static writeInviteMail() {
		locator.mailModel.getUserMailboxDetails().then((mailboxDetails) => {
			const editor = new MailEditor(mailboxDetails)
			const username = logins.getUserController().userGroupInfo.name;
			const body = lang.get("invitationMailBody_msg", {
				'{registrationLink}': "https://mail.tutanota.com/signup",
				'{username}': username,
				'{githubLink}': "https://github.com/tutao/tutanota"
			})
			editor.initWithTemplate({}, lang.get("invitationMailSubject_msg"), body, false).then(() => {
				editor.show()
			})
		})
	}
}

const ContactSuggestionHeight = 60

export class ContactSuggestion implements Suggestion {
	name: string;
	mailAddress: string;
	contact: ?Contact;
	selected: boolean;
	view: Function;

	constructor(name: string, mailAddress: string, contact: ?Contact) {
		this.name = name
		this.mailAddress = mailAddress
		this.contact = contact
		this.selected = false

		this.view = vnode => m(".pt-s.pb-s.click.content-hover", {
			class: this.selected ? 'content-accent-fg row-selected' : '',
			onmousedown: vnode.attrs.mouseDownHandler,
			style: {
				'padding-left': this.selected ? px(size.hpad_large - 3) : px(size.hpad_large),
				'border-left': this.selected ? "3px solid" : null,
				height: px(ContactSuggestionHeight),
			}
		}, [
			m("small", this.name),
			m(".name", this.mailAddress),
		])
	}

}

/**
 * open a MailEditor
 * @param mailboxDetails details to use when sending an email
 * @returns {*}
 * @private
 * @throws PermissionError
 */
export function newMail(mailboxDetails: MailboxDetail): Promise<MailEditor> {
	return checkApprovalStatus(false).then(sendAllowed => {
		if (sendAllowed) {
			let editor = new MailEditor(mailboxDetails)
			editor.initWithTemplate({}, "", "<br/>" + getEmailSignature())
			editor.show()
			return editor
		}
		return Promise.reject(new PermissionError("not allowed to send mail"))
	})
}


function getTemplateLanguages(sortedLanguages: Array<Language>): Promise<Array<Language>> {
	return logins.getUserController().loadCustomer()
	             .then((customer) => load(CustomerPropertiesTypeRef, neverNull(customer.properties)))
	             .then((customerProperties) => {
		             return sortedLanguages.filter(sL =>
			             customerProperties.notificationMailTemplates.find((nmt) => nmt.language === sL.code))
	             })
	             .catch(() => [])
}