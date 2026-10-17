import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { THEME } from '../theme.js';
import type { TaskItem } from '../../tasks/TaskGraph.js';

export interface TaskTrackerViewProps {
  tasks: TaskItem[];
  collapsed?: boolean;
}

function renderProgressBar(completed: number, total: number, width = 10): string {
  if (total <= 0) return '░'.repeat(width);
  const ratio = Math.max(0, Math.min(1, completed / total));
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export const TaskTrackerView: React.FC<TaskTrackerViewProps> = ({
  tasks,
  collapsed = false,
}) => {
  if (!tasks || tasks.length === 0) {
    return null;
  }

  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const inProgressTask = tasks.find((t) => t.status === 'in_progress');
  const totalCount = tasks.length;
  const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const progressBar = renderProgressBar(completedCount, totalCount, 12);

  // Active (uncompleted) tasks: when a task is ticked (completed), it disappears from the active view
  const activeTasks = tasks.filter((t) => t.status !== 'completed');

  // When all tasks are complete, dismiss the checklist completely
  if (activeTasks.length === 0) {
    return null;
  }

  // Limit displayed items to remaining active context
  const MAX_DISPLAY = 5;
  const displayTasks = activeTasks.slice(0, MAX_DISPLAY);
  const hiddenCount = activeTasks.length - displayTasks.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.colors.border}
      paddingX={1}
      marginY={0}
    >
      {/* Header with Title and Progress Bar */}
      <Box flexDirection="row" justifyContent="space-between" marginBottom={0}>
        <Box flexDirection="row" gap={1}>
          <Text bold color={THEME.colors.primary}>
            📋 TASK CHECKLIST
          </Text>
          <Text color={THEME.colors.muted}>
            (Claude Code / SWE-agent style)
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color={percentage === 100 ? THEME.colors.ok : THEME.colors.accent}>
            [{progressBar}] {percentage}% ({completedCount}/{totalCount})
          </Text>
        </Box>
      </Box>

      {/* Task List */}
      <Box flexDirection="column" marginTop={0}>
        {displayTasks.map((task) => {
          if (task.status === 'completed') {
            return (
              <Box key={task.id} flexDirection="row" gap={1}>
                <Text bold color={THEME.colors.ok}>
                  [✔]
                </Text>
                <Text color={THEME.colors.muted}>
                  #{task.id} {task.subject}
                </Text>
              </Box>
            );
          }

          if (task.status === 'in_progress') {
            return (
              <Box key={task.id} flexDirection="row" gap={1}>
                <Text bold color={THEME.colors.warn}>
                  [▶]
                </Text>
                <Text bold color={THEME.colors.interCyan}>
                  #{task.id} {task.subject}
                </Text>
                {task.activeForm ? (
                  <Box flexDirection="row" gap={1}>
                    <Text color={THEME.colors.primary}>
                      <Spinner type="dots" />
                    </Text>
                    <Text italic color={THEME.colors.muted}>
                      {task.activeForm}
                    </Text>
                  </Box>
                ) : (
                  <Text color={THEME.colors.primary}>
                    <Spinner type="dots" />
                  </Text>
                )}
              </Box>
            );
          }

          // Pending task
          return (
            <Box key={task.id} flexDirection="row" gap={1}>
              <Text color={THEME.colors.muted}>[○]</Text>
              <Text color={THEME.colors.text}>
                #{task.id} {task.subject}
              </Text>
            </Box>
          );
        })}

        {hiddenCount > 0 && (
          <Box marginTop={0}>
            <Text italic color={THEME.colors.muted}>
              ... (+{hiddenCount} more task{hiddenCount > 1 ? 's' : ''}, use /tasks to view all)
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
