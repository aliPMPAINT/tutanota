//@flow
import type {Shortcut} from "../misc/KeyManager"
import m from "mithril"
import {px} from "../gui/size"
import {CALENDAR_EVENT_HEIGHT, hasCapabilityOnGroup} from "./CalendarUtils"
import {animations, opacity, transform} from "../gui/animation/Animations"
import {ease} from "../gui/animation/Easing"
import {ButtonColors, ButtonN, ButtonType} from "../gui/base/ButtonN"
import {Icons} from "../gui/base/icons/Icons"
import {locator} from "../api/main/MainLocator"
import type {ModalComponent} from "../gui/base/Modal"
import {modal} from "../gui/base/Modal"
import {EventPreviewView} from "./EventPreviewView"
import type {CalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import {Dialog} from "../gui/base/Dialog"
import {styles} from "../gui/styles"
import {getEnabledMailAddressesWithUser} from "../mail/MailUtils"
import {logins} from "../api/main/LoginController"
import {getEventCancellationRecipients} from "./CalendarInvites"
import type {CalendarInfo} from "./CalendarView"
import {ShareCapability} from "../api/common/TutanotaConstants"
import type {CalendarUpdateDistributor} from "./CalendarUpdateDistributor"
import type {MailboxDetail} from "../mail/MailModel"

export class CalendarEventPopup implements ModalComponent {
	_calendarEvent: CalendarEvent;
	_rect: ClientRect;
	_canEdit: boolean;
	_onEditEvent: () => mixed;

	constructor(calendarEvent: CalendarEvent, calendars: Map<Id, CalendarInfo>, rect: ClientRect, onEditEvent: () => mixed) {
		this._calendarEvent = calendarEvent
		this._rect = rect
		this._onEditEvent = onEditEvent
		if (calendarEvent._ownerGroup == null) {
			throw new Error("Tried to open popup with non-persistent calendar event")
		}
		const calendarInfo = calendars.get(calendarEvent._ownerGroup)
		if (calendarInfo == null) {
			throw new Error("Passed event from unknown calendar")
		}
		this._canEdit = !calendarInfo.shared
			|| hasCapabilityOnGroup(logins.getUserController().user, calendarInfo.group, ShareCapability.Write)
	}

	show() {
		if (styles.isDesktopLayout()) {
			modal.displayUnique(this, false)
		} else {
			showMobileDialog({event: this._calendarEvent, canEdit: this._canEdit, onEditEvent: () => this._onEditEvent()})
		}
	}

	view(vnode: Vnode<any>) {
		return m(".abs.content-bg.plr.border-radius", {
				style: {
					width: "400px",
					boxShadow: "0 24px 38px 3px rgba(0,0,0,0.14),0 9px 46px 8px rgba(0,0,0,0.12),0 11px 15px -7px rgba(0,0,0,0.2)"
				},
				oncreate: ({dom}) => {
					const pos = this._rect
					if (pos.top < window.innerHeight / 2) {
						dom.style.top = px(pos.top + CALENDAR_EVENT_HEIGHT + 4)
					} else {
						dom.style.bottom = px(window.innerHeight - pos.top)
					}
					if (pos.left < window.innerWidth / 2) {
						dom.style.left = px(pos.left)
					} else {
						dom.style.right = px(window.innerWidth - pos.right)
					}
					animations.add(dom, [transform("translateX", -40, 0), opacity(0, 1, true)], {
						duration: 100,
						easing: ease.in
					})
				},
			},
			[
				m(".flex.flex-end", [
					m(ButtonN, {
						label: "edit_action",
						click: () => this._onEditEvent(),
						type: ButtonType.ActionLarge,
						icon: () => Icons.Edit,
						colors: ButtonColors.DrawerNav,
					}),
					this._canEdit
						? m(ButtonN, {
							label: "delete_action",
							click: () => deleteEvent(this._calendarEvent),
							type: ButtonType.ActionLarge,
							icon: () => Icons.Trash,
							colors: ButtonColors.DrawerNav,
						})
						: null,
					m(ButtonN, {
						label: "close_alt",
						click: () => modal.remove(this),
						type: ButtonType.ActionLarge,
						icon: () => Icons.Cancel,
						colors: ButtonColors.DrawerNav,
					}),
				]),
				m(EventPreviewView, {event: this._calendarEvent}),
			],
		)
	}

	backgroundClick(e: MouseEvent): void {
		modal.remove(this)
	}

	hideAnimation() {
		return Promise.resolve()
	}

	onClose(): void {
	}

	shortcuts(): Shortcut[] {
		return []
	}

	popState(e: Event): boolean {
		return true
	}
}

function showMobileDialog({event, onEditEvent, canEdit}: {event: CalendarEvent, canEdit: boolean, onEditEvent: () => mixed}) {
	const dialog = Dialog.largeDialog({
		left: [
			{
				label: "close_alt",
				click: () => dialog.close(),
				type: ButtonType.ActionLarge,
				icon: () => Icons.Cancel,
				colors: ButtonColors.DrawerNav,
			},
		],
		right: [
			{
				label: "edit_action",
				click: () => onEditEvent(),
				type: ButtonType.ActionLarge,
				icon: () => Icons.Edit,
				colors: ButtonColors.DrawerNav,
			}
		].concat(canEdit ? {
				label: "delete_action",
				click: () => deleteEvent(event),
				type: ButtonType.ActionLarge,
				icon: () => Icons.Trash,
				colors: ButtonColors.DrawerNav,
			}
			: []
		)
	}, {
		view: () => m(".mt.pl-s.pr-s", m(EventPreviewView, {event}))
	}).show()
}

function sendCancellationIfNeeded(event) {
	if (!event.isCopy) {
		return Promise.all([
			locator.calendarUpdateDistributor(),
			locator.mailModel.getUserMailboxDetails()
		]).then(([distributor, mailboxDetail]: [CalendarUpdateDistributor, MailboxDetail]) => {
			const mailAddreses = getEnabledMailAddressesWithUser(mailboxDetail, logins.getUserController().userGroupInfo)
			const recipients = getEventCancellationRecipients(event, mailAddreses)
			// TODO
			return Promise.resolve()
			// return distributor.sendCancellation(event, recipients, ExternalConfidentialMode.UNCONFIDENTIAL)
		})
	} else {
		return Promise.resolve()
	}
}

function deleteEvent(event: CalendarEvent) {
	Dialog.confirm("deleteEventConfirmation_msg").then((confirmed) => {
		if (confirmed) {
			sendCancellationIfNeeded(event)
				.then(() => locator.calendarModel().deleteEvent(event))
		}
	})
}