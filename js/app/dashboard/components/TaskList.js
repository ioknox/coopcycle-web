import React from 'react'
import { connect } from 'react-redux'
import { render } from 'react-dom'
import moment from 'moment'
import { Draggable, Droppable } from "react-beautiful-dnd"
import { withTranslation } from 'react-i18next'
import _ from 'lodash'

import Task from './Task'
import TaskListPopoverContent from './TaskListPopoverContent'
import { removeTasks, togglePolyline, optimizeTaskList } from '../redux/actions'
import { selectVisibleTaskIds } from '../redux/selectors'

moment.locale($('html').attr('lang'))

const TaskListPopoverContentWithTrans = withTranslation()(TaskListPopoverContent)

// OPTIMIZATION
// Avoid useless re-rendering when starting to drag
// @see https://egghead.io/lessons/react-optimize-performance-in-react-beautiful-dnd-with-shouldcomponentupdate-and-purecomponent
class InnerList extends React.Component {

  shouldComponentUpdate(nextProps) {
    if (nextProps.tasks === this.props.tasks) {
      return false
    }

    return true
  }

  render() {
    return _.map(this.props.tasks, (task, index) => {
      return (
        <Draggable key={ task['@id'] } draggableId={ task['@id'] } index={ index }>
          {(provided) => (
            <div
              ref={ provided.innerRef }
              { ...provided.draggableProps }
              { ...provided.dragHandleProps }
            >
              <Task
                task={ task }
                assigned={ true }
                onRemove={ task => this.props.onRemove(task) } />
            </div>
          )}
        </Draggable>
      )
    })
  }
}

class TaskList extends React.Component {

  constructor (props) {
    super(props)
    this.state = {
      collapsed: props.collapsed
    }
  }

  componentDidMount() {

    const { username, collapsed } = this.props

    $('#collapse-' + username).on('shown.bs.collapse', () => {
      this.setState({ collapsed: false })
    })

    $('#collapse-' + username).on('hidden.bs.collapse', () => {
      this.setState({ collapsed: true })
    })

    if (!collapsed) {
      $('#collapse-' + username).collapse('show')
    }
  }

  remove(task) {
    this.props.removeTasks(this.props.username, task)
  }

  onClickUnassign(e) {
    e.preventDefault()

    const $target = $(e.currentTarget)

    if (!$target.data('bs.popover')) {

      const { tasks } = this.props
      const uncompletedTasks = _.filter(tasks, t => t.status === 'TODO')

      const el = document.createElement('div')

      const cb = () => {
        $target.popover({
          trigger: 'manual',
          html: true,
          container: 'body',
          placement: 'left',
          content: el
        })
        $target.popover('toggle')
      }

      render(<TaskListPopoverContentWithTrans
        onClickCancel={ () => $target.popover('hide') }
        onClickConfirm={ () => {
          $target.popover('hide')
          this.props.removeTasks(this.props.username, uncompletedTasks)
        }} />, el, cb)
    } else {
      $target.popover('toggle')
    }
  }

  render() {

    const {
      duration,
      distance,
      username,
      polylineEnabled,
      isEmpty,
    } = this.props

    let { tasks } = this.props

    const { collapsed } = this.state

    tasks = _.orderBy(tasks, ['position', 'id'])

    const uncompletedTasks = _.filter(tasks, t => t.status === 'TODO')

    const durationFormatted = moment.utc()
      .startOf('day')
      .add(duration, 'seconds')
      .format('HH:mm')

    const distanceFormatted = (distance / 1000).toFixed(2) + ' Km',
      collabsableId = ['collapse', username].join('-')

    const polylineClassNames = ['pull-right', 'taskList__summary-polyline']
    if (polylineEnabled) {
      polylineClassNames.push('taskList__summary-polyline--enabled')
    }

    const avatarURL = window.Routing.generate('user_avatar', { username })

    const taskListClasslist = ['taskList__tasks', 'list-group', 'nomargin']
    if (isEmpty) {
      taskListClasslist.push('taskList__tasks--empty')
    }

    return (
      <div className="panel panel-default nomargin noradius noborder">
        <div className="panel-heading dashboard__panel__heading">
          <h3 className="panel-title taskList__panel-title">
            <a
              className="dashboard__panel__heading__link"
              role="button"
              data-toggle="collapse"
              data-target={ '#' + collabsableId }
              aria-expanded={ collapsed ? 'false' : 'true' }
            >
              <img src={ avatarURL } width="20" height="20" /> 
              <span>{ username }</span>
              &nbsp;&nbsp;
              <span className="badge">{ tasks.length }</span>
              &nbsp;&nbsp;
              <i className={ collapsed ? 'fa fa-caret-down' : 'fa fa-caret-up' }></i>
            </a>
            { tasks.length > 1 && (
            <a href="#" onClick={ e => {
              e.preventDefault()
              this.props.optimizeTaskList({
                '@id': this.props.uri,
                username: this.props.username,
              })
            }} className="mr-2" style={{ color: '#f1c40f' }} label="Optimize">
              <i className="fa fa-bolt"></i>
            </a>
            )}
            { uncompletedTasks.length > 0 && (
            <a onClick={ e => this.onClickUnassign(e) } className="taskList__panel-title__unassign">
              <i className="fa fa-close"></i>
            </a>
            )}
          </h3>
        </div>
        <div role="tabpanel" id={ collabsableId } className="collapse">
          { tasks.length > 0 && (
            <div className="panel-body taskList__summary">
              <strong>{ this.props.t('ADMIN_DASHBOARD_DURATION') }</strong>  <span>{ durationFormatted }</span> - <strong>{ this.props.t('ADMIN_DASHBOARD_DISTANCE') }</strong>  <span>{ distanceFormatted }</span>
              <a role="button" className={ polylineClassNames.join(' ') } onClick={ () => this.props.togglePolyline(username) }>
                <i className="fa fa-map fa-2x"></i>
              </a>
            </div>
          )}
          <Droppable droppableId={ `assigned:${username}` }>
            {(provided) => (
              <div className={ taskListClasslist.join(' ') } ref={ provided.innerRef } { ...provided.droppableProps }>
                <InnerList
                  tasks={ tasks }
                  onRemove={ task => this.remove(task) } />
                { provided.placeholder }
              </div>
            )}
          </Droppable>
        </div>
      </div>
    )
  }
}

function mapStateToProps(state, ownProps) {

  const visibleTaskIds = _.intersectionWith(
    selectVisibleTaskIds(state),
    ownProps.items.map(task => task['@id'])
  )

  return {
    polylineEnabled: state.polylineEnabled[ownProps.username],
    tasks: ownProps.items,
    isEmpty: ownProps.items.length === 0 || visibleTaskIds.length === 0,
    distance: ownProps.distance,
    duration: ownProps.duration,
    filters: state.filters,
  }
}

function mapDispatchToProps(dispatch) {
  return {
    removeTasks: (username, tasks) => dispatch(removeTasks(username, tasks)),
    togglePolyline: (username) => dispatch(togglePolyline(username)),
    optimizeTaskList: (taskList) => dispatch(optimizeTaskList(taskList)),
  }
}

export default connect(mapStateToProps, mapDispatchToProps)(withTranslation()(TaskList))
